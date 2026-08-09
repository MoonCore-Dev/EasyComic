import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Comic, LoadedComic } from '../types/comic'
import type { LoadComicResult, ScannedComicFile } from '../vite-env.d'
import { useToast } from '../store/toast'
import { usePersisted, clearAllPersisted } from './usePersisted'
import { invalidateCoverCache } from '../components/CoverResolver'

function getBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

function getParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return ''
  return filePath.slice(0, idx)
}

/** 根据 sourcePath 把标题尾部的扩展名去掉（兼容旧数据 / 旧主进程） */
function stripTitleExtension(title: string, sourcePath?: string): string {
  if (!sourcePath || !title) return title
  const lowerPath = sourcePath.toLowerCase()
  const pathExtMatch = lowerPath.match(/\.[^.\\/]+$/)
  if (!pathExtMatch) return title
  const pathExt = pathExtMatch[0]
  if (title.toLowerCase().endsWith(pathExt)) {
    return title.slice(0, -pathExt.length)
  }
  return title
}

function getFileTypeLabel(sourcePath: string): string {
  const lower = sourcePath.toLowerCase().replace(/\\/g, '/')
  const hasExt = /\.[^.]+$/.test(lower)

  // 无扩展名 → 文件夹（实际格式由主进程在加载时推断，刷新后即可显示如 PNG/JPG 等）
  if (!hasExt) return '文件夹'

  const ext = lower.substring(lower.lastIndexOf('.'))
  const map: Record<string, string> = {
    '.cbz': 'CBZ', '.zip': 'ZIP',
    '.cbr': 'CBR', '.rar': 'RAR',
    '.cb7': 'CB7', '.7z': '7Z',
    '.cbt': 'CBT', '.tar': 'TAR',
    '.pdf': 'PDF',
    '.epub': 'EPUB',
    '.fb2': 'FB2',
    '.jpg': 'JPG', '.jpeg': 'JPG', '.png': 'PNG', '.webp': 'WEBP',
    '.avif': 'AVIF', '.gif': 'GIF', '.bmp': 'BMP', '.tif': 'TIFF', '.tiff': 'TIFF'
  }
  return map[ext] || ext.toUpperCase().replace('.', '')
}

const COMICS_KEY = 'easycomic:comics'
const READ_KEY = 'easycomic:progress'
const REMOVED_KEY = 'easycomic:removed-sources'

function getComicApi() {
  if (typeof window === 'undefined') return null
  return (window as any).electronAPI?.comic || null
}

function isDemo(): boolean {
  return !getComicApi()
}

function genId() {
  return 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function genBatchId() {
  return 'b_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function useComicLibrary() {
  // 三大数据：书库列表、移除黑名单、最近阅读进度缓存（均走 Electron store / localStorage 兜底）
  const { value: comics, setValue: setComics, initialized: comicsInitialized } = usePersisted<Comic[]>(COMICS_KEY, [])
  const { value: removed, setValue: setRemoved, initialized: removedInitialized } = usePersisted<string[]>(REMOVED_KEY, [])
  // READ_KEY 只作为 write-only 的缓存，无需读
  const { setValue: setProgressCache } = usePersisted<{ id: string; pageIndex: number; total: number; at: number } | null>(READ_KEY, null)
  // 纯内存 UI 状态（不持久化）
  const [loadingSource, setLoadingSource] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { showToast, showConfirm } = useToast()

  // 迁移：为旧漫画添加 addedAt 字段
  useEffect(() => {
    const needsMigration = comics.some((c) => c.addedAt === undefined || c.addedAt === null)
    if (needsMigration) {
      setComics((prev) =>
        prev.map((c) => ({
          ...c,
          addedAt: c.addedAt ?? c.lastReadAt ?? 0
        }))
      )
    }
  }, [comics, setComics])

  // 迁移：旧版 comics.json 把首图全分辨率 base64 写进 coverDataUrl，导致文件膨胀。
  // 这里把 coverDataUrl 转成磁盘缩略图（coverPath 文件），并剔除 coverDataUrl 字段，
  // 让书库文件回到只存路径的轻量状态。仅对"有 coverDataUrl 且无 coverPath"的旧条目执行。
  useEffect(() => {
    const targets = comics.filter((c) => !!c.coverDataUrl && !c.coverPath && !!c.id)
    if (targets.length === 0) return
    const api = getComicApi()
    if (!api?.saveCover || !api?.getCover) return
    let cancelled = false
    ;(async () => {
      const updates: { id: string; coverPath: string }[] = []
      for (const c of targets) {
        if (cancelled) break
        try {
          const thumb = await makeThumbnail(c.coverDataUrl as string)
          const cp = await api.saveCover({ id: c.id, dataUrl: thumb })
          if (cp) updates.push({ id: c.id, coverPath: cp })
        } catch (e) {
          console.warn('[EasyComic] 封面迁移失败:', c.id, (e as Error)?.message ?? e)
        }
      }
      if (updates.length > 0 && !cancelled) {
        setComics((prev) =>
          prev.map((c) => {
            const u = updates.find((x) => x.id === c.id)
            if (!u) return c
            const { coverDataUrl: _drop, ...rest } = c
            return { ...rest, coverPath: u.coverPath }
          })
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [comics, setComics])

  // 监听封面自愈事件：CoverResolver 从源文件恢复封面后，把 coverPath 持久化回书库，
  // 避免每次打开书库都重新 load 整本漫画。
  useEffect(() => {
    const onRecovered = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; coverPath: string }>).detail
      if (!detail?.id || !detail?.coverPath) return
      setComics((prev) =>
        prev.map((c) => (c.id === detail.id ? { ...c, coverPath: detail.coverPath, coverDataUrl: undefined } : c))
      )
    }
    window.addEventListener('easycomic:cover-recovered', onRecovered as EventListener)
    return () => window.removeEventListener('easycomic:cover-recovered', onRecovered as EventListener)
  }, [setComics])

  const demoComics: Comic[] = [
    {
      id: 'demo_1',
      title: '示例漫画：夏日祭典',
      sourcePath: '',
      coverDataUrl: createDemoCover('夏', '#6B8AFE', '#FFC9C9'),
      pageCount: 42,
      progress: 0.24,
      lastReadAt: Date.now() - 86400000 * 2,
      addedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'demo_2',
      title: '示例漫画：街角咖啡店',
      sourcePath: '',
      coverDataUrl: createDemoCover('Café', '#8B5CF6', '#A7F3D0'),
      pageCount: 68,
      progress: 0.7,
      lastReadAt: Date.now() - 3600000,
      addedAt: Date.now() - 86400000 * 3
    },
    {
      id: 'demo_3',
      title: '示例漫画：星河之旅',
      sourcePath: '',
      coverDataUrl: createDemoCover('星', '#06B6D4', '#1E2020'),
      pageCount: 120,
      progress: 0,
      lastReadAt: 0,
      addedAt: Date.now() - 86400000 * 1
    }
  ]

  const normalizedComics: Comic[] = useMemo(() => {
    const base = isDemo() && comics.length === 0 ? demoComics : comics
    return base.map((c) => ({ ...c, title: stripTitleExtension(c.title, c.sourcePath) }))
  }, [comics])

  const allComics: Comic[] = normalizedComics
  const visibleComics: Comic[] = allComics.filter((c) => !c.hidden)

  const markProgress = useCallback((id: string, pageIndex: number, total: number) => {
    const p = total > 0 ? Math.max(0, Math.min(1, (pageIndex + 1) / total)) : 0
    setComics((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx < 0) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], progress: p, lastReadAt: Date.now() }
      return next
    })
    setProgressCache({ id, pageIndex, total, at: Date.now() })
  }, [setComics, setProgressCache])

  const clearFromRecent = useCallback((id: string) => {
    setComics((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx < 0) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], lastReadAt: 0 }
      return next
    })
  }, [setComics])

  const removeComic = useCallback((id: string) => {
    const target = comics.find((c) => c.id === id)
    if (target?.coverPath) {
      getComicApi()?.deleteCover(target.coverPath)
    }
    invalidateCoverCache(id)
    setComics((prev) => {
      const t = prev.find((c) => c.id === id)
      if (t?.sourcePath) {
        setRemoved((prevRemoved) => {
          if (prevRemoved.includes(t.sourcePath)) return prevRemoved
          return [...prevRemoved, t.sourcePath]
        })
      }
      return prev.filter((c) => c.id !== id)
    })
  }, [comics, setComics, setRemoved])

  const toggleHidden = useCallback((id: string) => {
    setComics((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx < 0) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], hidden: !next[idx].hidden }
      return next
    })
  }, [setComics])

  const toggleBatchHidden = useCallback((batchSource: string) => {
    setComics((prev) => {
      const batch = prev.filter((c) => c.batchSource === batchSource)
      if (batch.length === 0) return prev
      const targetHidden = !batch.every((c) => c.hidden)
      return prev.map((c) => c.batchSource === batchSource ? { ...c, hidden: targetHidden } : c)
    })
  }, [setComics])

  const removeBatch = useCallback((batchSource: string) => {
    const batch = comics.filter((c) => c.batchSource === batchSource)
    const api = getComicApi()
    for (const c of batch) {
      if (c.coverPath) api?.deleteCover(c.coverPath)
      invalidateCoverCache(c.id)
    }
    setComics((prev) => {
      if (batch.length === 0) return prev
      setRemoved((prevRemoved) => {
        const newRemoved = [...prevRemoved]
        for (const c of batch) {
          if (c.sourcePath && !newRemoved.includes(c.sourcePath)) newRemoved.push(c.sourcePath)
        }
        return newRemoved
      })
      return prev.filter((c) => c.batchSource !== batchSource)
    })
  }, [comics, setComics, setRemoved])

  const unmarkRemovedSource = useCallback((sourcePath: string) => {
    setRemoved((prev) => prev.filter((p) => p !== sourcePath))
  }, [setRemoved])

  const changeCover = useCallback(async (id: string): Promise<boolean> => {
    const api = getComicApi()
    if (!api) {
      showToast('请在 Electron 环境下运行以使用更换封面功能。', 'warning')
      return false
    }
    const result = await api.pickCoverImage()
    if (!result) return false
    const coverPath = await generateCoverPath(api, id, result.dataUrl)
    if (!coverPath) {
      showToast('封面保存失败，请重试。', 'error')
      return false
    }
    invalidateCoverCache(id)
    setComics((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx < 0) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], coverPath, customCover: true, coverDataUrl: undefined }
      return next
    })
    return true
  }, [setComics, showToast])

  const importFromSource = useCallback(async (sourcePath: string): Promise<Comic | null> => {
    const api = getComicApi()
    if (!api) {
      showToast('请在 Electron 环境下运行以使用真实导入功能。', 'warning')
      return null
    }
    if (removed.includes(sourcePath)) {
      const ok = await showConfirm({
        title: '重新加入书库？',
        message: '此漫画之前曾从书库移除，是否重新加入书库？',
        confirmText: '加入',
        cancelText: '取消',
        dismissibleId: 're-add-comic'
      })
      if (!ok) return null
      unmarkRemovedSource(sourcePath)
    }
    setLoadingSource(sourcePath)
    try {
      let scanned: ScannedComicFile[] = []
      try {
        scanned = await api.scanFolder(sourcePath)
      } catch {
        // 非文件夹，跳过扫描走单文件导入
      }

      if (scanned.length > 0) {
        const batchId = genBatchId()
        const batchSource = sourcePath
        const imported: Comic[] = []
        const errors: string[] = []
        const skipped: string[] = []
        for (const file of scanned) {
          if (removed.includes(file.path)) {
            skipped.push(file.path)
            continue
          }
          setLoadingSource(file.path)
          try {
            const result: LoadComicResult = await api.load(file.path)
            if (result.pageCount === 0) {
              errors.push(`${getBasename(file.path)}: 未找到图片页`)
              continue
            }
            const id = genId()
            const coverPath = await generateCoverPath(api, id, result.firstPage?.dataUrl)
            imported.push({
              id,
              title: stripTitleExtension(result.title, result.source),
              sourcePath: result.source,
              coverPath,
              pageCount: result.pageCount,
              progress: 0,
              lastReadAt: 0,
              addedAt: Date.now(),
              batchId,
              batchSource,
              isFolder: result.isFolder,
              fileType: result.fileType || getFileTypeLabel(file.path)
            })
          } catch (e: any) {
            errors.push(`${getBasename(file.path)}: ${e?.message ?? '加载失败'}`)
          }
        }

        if (skipped.length > 0) {
          const ok = await showConfirm({
            title: '重新加入书库？',
            message: `检测到 ${skipped.length} 本之前被移除的漫画${imported.length > 0 ? `，已有 ${imported.length} 本新增导入` : ''}，是否将这些移除的漫画也重新加入书库？`,
            confirmText: '全部加入',
            cancelText: '跳过',
            dismissibleId: 're-add-batch'
          })
          if (ok) {
            setRemoved((prev) => prev.filter((p) => !skipped.includes(p)))
            for (const filePath of skipped) {
              setLoadingSource(filePath)
              try {
                const result: LoadComicResult = await api.load(filePath)
                if (result.pageCount > 0) {
                  const id = genId()
                  const coverPath = await generateCoverPath(api, id, result.firstPage?.dataUrl)
                  imported.push({
                    id,
                    title: stripTitleExtension(result.title, result.source),
                    sourcePath: result.source,
                    coverPath,
                    pageCount: result.pageCount,
                    progress: 0,
                    lastReadAt: 0,
                    addedAt: Date.now(),
                    batchId,
                    batchSource,
                    isFolder: result.isFolder,
                    fileType: result.fileType || getFileTypeLabel(filePath)
                  })
                }
              } catch (e: any) {
                errors.push(`${getBasename(filePath)}: ${e?.message ?? '加载失败'}`)
              }
            }
          }
        }

        if (imported.length > 0) {
          setComics((prev) => {
            const existingPaths = new Set(prev.map((c) => c.sourcePath))
            const fresh = imported.filter((c) => !existingPaths.has(c.sourcePath))
            return [...fresh, ...prev]
          })
                    if (errors.length > 0) {
            showToast(`成功导入 ${imported.length} 本，但 ${errors.length} 本失败（如：${errors[0]}）`, 'warning')
          } else {
            showToast(`成功导入 ${imported.length} 本漫画${skipped.length > 0 ? `（含 ${skipped.length} 本重新加入）` : ''}`, 'success')
          }
          return imported[0]
        }
        if (errors.length > 0) {
          showToast(`导入失败: ${errors[0]}`, 'error')
        } else {
          showToast('文件夹内未找到可导入的漫画文件。', 'warning')
        }
        return null
      }

      // 无扫描结果：作为单本导入
      const result: LoadComicResult = await api.load(sourcePath)
      if (result.pageCount === 0) {
        showToast('未找到可识别的图片页。', 'warning')
        return null
      }
      const isFolder = result.isFolder
      const id = genId()
      const coverPath = await generateCoverPath(api, id, result.firstPage?.dataUrl)
      const newComic: Comic = {
        id,
        title: stripTitleExtension(result.title, result.source),
        sourcePath: result.source,
        coverPath,
        pageCount: result.pageCount,
        progress: 0,
        lastReadAt: 0,
        addedAt: Date.now(),
        isFolder,
        fileType: result.fileType || getFileTypeLabel(sourcePath)
      }
      setComics((prev) => {
        const dup = prev.find((c) => c.sourcePath === sourcePath)
        if (dup) return prev
        return [newComic, ...prev]
      })
      showToast(`成功导入「${result.title}」`, 'success')
      return newComic
    } catch (e: any) {
      showToast('导入失败：' + (e?.message ?? String(e)), 'error')
      return null
    } finally {
      setLoadingSource(null)
    }
  }, [removed, unmarkRemovedSource, showToast, showConfirm, setComics, setRemoved])

  const openImportDialog = useCallback(async (): Promise<Comic | null> => {
    const api = getComicApi()
    if (!api) {
      showToast('请在 Electron 环境下运行以使用真实导入功能。', 'warning')
      return null
    }
    const folder = await api.pickFolder()
    if (!folder) {
      const file = await api.pickFile()
      if (!file) return null
      return importFromSource(file)
    }
    return importFromSource(folder)
  }, [importFromSource, showToast])

  const importFromFolder = useCallback(async (): Promise<Comic | null> => {
    const api = getComicApi()
    if (!api) {
      showToast('请在 Electron 环境下运行以使用真实导入功能。', 'warning')
      return null
    }
    const folder = await api.pickFolder()
    if (!folder) return null
    return importFromSource(folder)
  }, [importFromSource, showToast])

  const importFromFile = useCallback(async (): Promise<Comic | null> => {
    const api = getComicApi()
    if (!api) {
      showToast('请在 Electron 环境下运行以使用真实导入功能。', 'warning')
      return null
    }
    const file = await api.pickFile()
    if (!file) return null
    return importFromSource(file)
  }, [importFromSource, showToast])

  const loadComicForReading = useCallback(async (id: string): Promise<LoadedComic | null> => {
    const comic = visibleComics.find((c) => c.id === id)
    if (!comic) return null
    // 懒加载架构：阅读器只接收 comic（含 sourcePath / pageCount），逐页自行向主进程请求
    if (isDemo()) {
      return { comic }
    }
    const api = getComicApi()
    if (!api) return null
    setLoadingSource(comic.sourcePath)
    try {
      await api.load(comic.sourcePath) // 触发主进程 openComic（解析页结构 + 缓存），失败在此抛出
      return { comic }
    } catch (e: any) {
      showToast('打开失败：' + (e?.message ?? String(e)), 'error')
      return null
    } finally {
      setLoadingSource(null)
    }
  }, [visibleComics, showToast])

  const refreshAll = useCallback(async (): Promise<void> => {
    if (isDemo()) {
      setIsRefreshing(true)
      await new Promise((r) => setTimeout(r, 600))
      setIsRefreshing(false)
      return
    }
    const api = getComicApi()
    if (!api) return
    setIsRefreshing(true)
    try {
      const existingPaths = new Set(comics.map((c) => c.sourcePath).filter(Boolean))

      // 1. 扫描所有已导入来源的父目录，导入新增的漫画
      const foldersToScan = new Set<string>()
      for (const c of comics) {
        if (!c.sourcePath) continue
        const folder = c.batchSource || getParentDir(c.sourcePath)
        if (folder) foldersToScan.add(folder)
      }

      const imported: Comic[] = []
      const errors: string[] = []
      for (const folder of foldersToScan) {
        try {
          const scanned = await api.scanFolder(folder)
          const batchId = genBatchId()
          for (const file of scanned) {
            if (existingPaths.has(file.path) || removed.includes(file.path)) continue
            setLoadingSource(file.path)
            try {
              const result: LoadComicResult = await api.load(file.path)
              if (result.pageCount === 0) {
                errors.push(`${getBasename(file.path)}: 未找到图片页`)
                continue
              }
              const id = genId()
              const coverPath = await generateCoverPath(api, id, result.firstPage?.dataUrl)
              imported.push({
                id,
                title: stripTitleExtension(result.title, result.source),
                sourcePath: result.source,
                coverPath,
                pageCount: result.pageCount,
                progress: 0,
                lastReadAt: 0,
                addedAt: Date.now(),
                batchId,
                batchSource: folder,
                isFolder: result.isFolder,
                fileType: result.fileType || getFileTypeLabel(file.path)
              })
              existingPaths.add(result.source)
            } catch (e: any) {
              errors.push(`${getBasename(file.path)}: ${e?.message ?? '加载失败'}`)
            }
          }
        } catch (e: any) {
          errors.push(`${folder}: 扫描失败`)
        }
      }

      // 2. 更新已有漫画的元数据（页数、非自定义封面），不影响阅读进度
      const updated: Comic[] = []
      for (const c of comics) {
        if (!c.sourcePath) {
          updated.push(c)
          continue
        }
        try {
          setLoadingSource(c.sourcePath)
          const result: LoadComicResult = await api.load(c.sourcePath)
          const firstImg = result.firstPage?.dataUrl
          let coverPath = c.coverPath
          if (!c.customCover && firstImg) {
            const cp = await generateCoverPath(api, c.id, firstImg)
            if (cp) coverPath = cp
          }
          updated.push({
            ...c,
            // 用主进程最新返回的 title 覆盖旧值（去掉扩展名等）
            title: stripTitleExtension(result.title || c.title, c.sourcePath),
            pageCount: result.pageCount,
            coverPath,
            fileType: result.fileType || c.fileType || getFileTypeLabel(c.sourcePath)
          })
        } catch {
          updated.push(c)
        }
      }

      if (imported.length > 0) {
        setComics([...imported, ...updated])
      } else {
        setComics(updated)
      }

      if (errors.length > 0) {
        showToast(`刷新完成：新增 ${imported.length} 本，${errors.length} 个错误（如：${errors[0]}）`, 'warning')
      } else if (imported.length > 0) {
        showToast(`刷新完成：新增导入 ${imported.length} 本漫画`, 'success')
      } else {
        showToast('已扫描所有来源，未发现新增漫画', 'info')
      }
    } finally {
      setLoadingSource(null)
      setIsRefreshing(false)
    }
  }, [comics, removed, setComics, showToast])

  // ═══ 清空所有用户数据：磁盘文件 → localStorage → 内存缓存 → 显式写默认值 ═══
  const clearAllData = useCallback(async (): Promise<boolean> => {
    try {
      // 1. 先删磁盘文件
      const storeApi = (window as any).electronAPI?.store
      if (storeApi?.clearAll) {
        await storeApi.clearAll()
      }
      // 2. 清空 localStorage
      localStorage.clear()
      // 3. 清内存缓存 + 丢弃待写队列 + 通知所有组件重渲染
      clearAllPersisted()
      // 4. 显式写默认值到 memoryCache + scheduleWrite
      //    确保 memoryCache 明确持有空值（而非"不存在"），防止任何代码路径读到旧值
      setComics([])
      setRemoved([])
      setProgressCache(null)
      return true
    } catch (err) {
      console.error('[EasyComic] clearAllData failed:', err)
      return false
    }
  }, [setComics, setRemoved, setProgressCache])

  return {
    comics: visibleComics,
    allComics,
    loadingSource,
    isRefreshing,
    refreshAll,
    clearAllData,
    openImportDialog,
    importFromFolder,
    importFromFile,
    importFromSource,
    loadComicForReading,
    markProgress,
    clearFromRecent,
    removeComic,
    toggleHidden,
    toggleBatchHidden,
    removeBatch,
    changeCover,
    isDemo: isDemo(),
    initialized: comicsInitialized && removedInitialized
  }
}

/**
 * 把一张图（dataUrl）缩成最长边不超过 maxSize 的 JPEG 缩略图 dataUrl。
 * 用于封面缓存：避免把首图全分辨率 base64 写进 comics.json 导致文件膨胀。
 */
async function makeThumbnail(dataUrl: string, maxSize = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 canvas 上下文'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('缩略图解码失败'))
    img.src = dataUrl
  })
}

/**
 * 生成并落盘缓存封面缩略图，返回相对路径（comics.json 只存这个路径）；
 * 失败返回 undefined，由 CoverResolver 回退到 coverDataUrl 显示。
 */
async function generateCoverPath(api: any, id: string, firstPageDataUrl: string | undefined): Promise<string | undefined> {
  if (!firstPageDataUrl) return undefined
  try {
    const thumb = await makeThumbnail(firstPageDataUrl)
    const coverPath = await api.saveCover({ id, dataUrl: thumb })
    return coverPath ?? undefined
  } catch (e) {
    console.warn('[EasyComic] 生成封面缩略图失败:', (e as Error)?.message ?? e)
    return undefined
  }
}

function createDemoCover(label: string, colorTop: string, colorBottom: string): string {
  const w = 320
  const h = 480
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colorTop}"/>
      <stop offset="1" stop-color="${colorBottom}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" rx="12" fill="url(#g)"/>
  <circle cx="${w * 0.8}" cy="${h * 0.18}" r="${h * 0.08}" fill="rgba(255,255,255,0.25)"/>
  <circle cx="${w * 0.25}" cy="${h * 0.82}" r="${h * 0.11}" fill="rgba(255,255,255,0.18)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="Segoe UI, system-ui, sans-serif" font-weight="700"
        font-size="${Math.floor(h * 0.13)}" fill="rgba(255,255,255,0.92)">${label}</text>
  <text x="50%" y="${h * 0.62}" dominant-baseline="middle" text-anchor="middle"
        font-family="Segoe UI, system-ui, sans-serif" font-weight="500"
        font-size="${Math.floor(h * 0.04)}" fill="rgba(255,255,255,0.7)">EasyComic · 演示封面</text>
</svg>`.trim()
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function createDemoPage(title: string, page: number, total: number, _coverDataUrl?: string): string {
  const w = 900
  const h = 1280
  const header = `${title} · 第 ${page} / ${total} 页`
  const tips = [
    '← / → 翻页，空格/PageDown 下一页，Esc 返回书库',
    '点击画面左侧 35% 上一页，右侧 35% 下一页',
    '演示模式：导入真实漫画后将显示真实内容',
    '支持格式：CBZ / ZIP / CBT / TAR / PDF / 图片文件夹'
  ]
  const pattern = tips[(page - 1) % tips.length]
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#F6F6F8"/>
  <rect x="40" y="40" width="${w - 80}" height="${h - 80}" rx="16" fill="#ffffff" stroke="#E9E8EF" stroke-width="2"/>
  <text x="${w / 2}" y="120" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="28" font-weight="700" fill="#1E2020">${header}</text>
  <g transform="translate(120, 180)">
    <rect width="${w - 240}" height="${h - 360}" rx="18" fill="url(#pBg)"/>
    <defs>
      <linearGradient id="pBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#E9E8EF"/>
        <stop offset="1" stop-color="#D6D8DD"/>
      </linearGradient>
    </defs>
    <rect x="40" y="40" width="${w - 320}" height="${Math.floor((h - 360) * 0.35)}" rx="12" fill="#ffffff" opacity="0.75"/>
    <rect x="40" y="${40 + Math.floor((h - 360) * 0.42)}" width="${Math.floor((w - 320) * 0.46)}" height="${Math.floor((h - 360) * 0.5)}" rx="12" fill="#ffffff" opacity="0.75"/>
    <rect x="${40 + Math.floor((w - 320) * 0.52)}" y="${40 + Math.floor((h - 360) * 0.42)}" width="${Math.floor((w - 320) * 0.46)}" height="${Math.floor((h - 360) * 0.5)}" rx="12" fill="#ffffff" opacity="0.75"/>
  </g>
  <text x="${w / 2}" y="${h - 80}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="22" fill="#1E2020">${pattern}</text>
</svg>`.trim()
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
