import { useEffect, useState, type ReactNode } from 'react'
import type { Comic } from '../types/comic'

/**
 * 全局内存封面缓存（LRU）。
 * 漫画导入后只存磁盘路径 coverPath，返回书库时重新挂载 CoverResolver 需要异步读取封面，
 * 期间会闪现首字母占位。用内存缓存保存最近解析出的 dataUrl，切换回来时即可同步显示，
 * 避免"先闪首字母再出封面"的视觉抖动。
 */
const coverCache = new Map<string, string>()
const MAX_COVER_CACHE = 200

function readCoverCache(id: string): string | undefined {
  const hit = coverCache.get(id)
  if (hit !== undefined) {
    // LRU：命中后移到末尾
    coverCache.delete(id)
    coverCache.set(id, hit)
  }
  return hit
}

function writeCoverCache(id: string, dataUrl: string) {
  if (coverCache.has(id)) coverCache.delete(id)
  coverCache.set(id, dataUrl)
  while (coverCache.size > MAX_COVER_CACHE) {
    const first = coverCache.keys().next().value
    if (first !== undefined) coverCache.delete(first)
  }
}

/** 让外部在删除/更换封面时清缓存 */
export function invalidateCoverCache(id?: string) {
  if (id) {
    coverCache.delete(id)
  } else {
    coverCache.clear()
  }
}

/**
 * 把首图 dataUrl 缩成最长边 ≤ maxSize 的 JPEG 缩略图 dataUrl（renderer 端，用 canvas）。
 * 与 useComicLibrary 内的 makeThumbnail 逻辑一致，这里内联以便 CoverResolver 自愈时独立使用。
 */
async function makeThumb(dataUrl: string, maxSize = 480): Promise<string> {
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
 * CoverResolver —— 把漫画封面解析为可直接用于 <img src> 或 backgroundImage 的 dataUrl。
 *
 * 解析顺序：
 *   1. 新版封面缓存在磁盘（comic.coverPath）→ 通过 getCover IPC 读取；
 *   2. 旧版 / 演示漫画的 comic.coverDataUrl 兜底；
 *   3. 【自愈】若两者都没有（例如导入时缩略图生成失败、磁盘缓存丢失），则从漫画源文件
 *      load 首图，先以原图显示，再尝试生成磁盘缩略图并通过事件持久化 coverPath。
 *      这样即使导入阶段封面生成失败，打开书库也能自动恢复，且不把大图写进 comics.json。
 */
export function CoverResolver({
  comic,
  children
}: {
  comic: Comic
  children: (src: string | null) => ReactNode
}) {
  // 初始值：coverDataUrl > 内存缓存 > null。
  // 内存缓存让从其他界面返回书库/最近阅读时，能立即显示上次解析好的封面，避免首字母闪烁。
  const [src, setSrc] = useState<string | null>(
    comic.coverDataUrl ?? readCoverCache(comic.id) ?? null
  )

  useEffect(() => {
    let cancelled = false
    // 同步先用 coverDataUrl 占位/显示，保证首屏不闪现首字母
    if (comic.coverDataUrl) {
      setSrc(comic.coverDataUrl)
    }

    const resolve = async () => {
      const api = (window as any).electronAPI?.comic
      // 1) 优先磁盘缓存
      if (comic.coverPath && api?.getCover) {
        try {
          const dataUrl = await api.getCover(comic.coverPath)
          if (!cancelled && dataUrl) {
            writeCoverCache(comic.id, dataUrl)
            setSrc(dataUrl)
            return
          }
        } catch {
          // 读取失败 → 继续兜底
        }
      }
      // 2) 旧版 / 演示兜底
      if (!cancelled && comic.coverDataUrl) {
        writeCoverCache(comic.id, comic.coverDataUrl)
        setSrc(comic.coverDataUrl)
        return
      }
      // 3) 自愈：从源文件恢复
      if (!cancelled && comic.sourcePath && api?.load) {
        try {
          const result = await api.load(comic.sourcePath)
          // 懒加载架构下 LoadComicResult 不再返回 pages，首图由 firstPage 提供
          const first = result?.firstPage?.dataUrl
          if (!cancelled && first) {
            // 立即显示原图，保证封面可见
            writeCoverCache(comic.id, first)
            setSrc(first)
            // 尝试生成磁盘缩略图缓存
            try {
              const thumb = await makeThumb(first)
              const cp = await api.saveCover({ id: comic.id, dataUrl: thumb })
              if (cp && !cancelled) {
                window.dispatchEvent(
                  new CustomEvent('easycomic:cover-recovered', {
                    detail: { id: comic.id, coverPath: cp }
                  })
                )
                const d = await api.getCover(cp)
                if (d) {
                  writeCoverCache(comic.id, d)
                  setSrc(d)
                }
              }
            } catch (e) {
              console.warn('[EasyComic] 封面自愈缩略图生成失败（已用原图兜底）:', (e as Error)?.message ?? e)
            }
          }
        } catch (e) {
          console.warn('[EasyComic] 封面自愈加载源失败:', (e as Error)?.message ?? e)
        }
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [comic.coverPath, comic.coverDataUrl, comic.sourcePath, comic.id])

  return <>{children(src)}</>
}
