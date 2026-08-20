import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Library from './components/Library'
import RecentReading from './components/RecentReading'
import Search from './components/Search'
import ComicReader from './components/ComicReader'
import SettingsModal from './components/SettingsModal'
import { CoverResolver } from './components/CoverResolver'
import BackdropLayer from './components/BackdropLayer'
import CustomScrollbar from './components/CustomScrollbar'
import { useComicLibrary } from './comic/useComicLibrary'
import { flushPendingWrites } from './comic/usePersisted'
import { useHomeSettings } from './comic/useHomeSettings'
import { ToastProvider, useToast } from './store/toast'
import type { ViewType, LoadedComic, Comic } from './types/comic'
import './App.css'

function getBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

interface BatchGroup {
  /** 以文件夹路径作为唯一聚合键，避免刷新后生成新 batchId 导致同一文件夹重复显示 */
  batchSource: string
  items: Comic[]
  allHidden: boolean
}

function groupComics(allComics: Comic[]): { batches: BatchGroup[]; singles: Comic[] } {
  const sourceMap = new Map<string, BatchGroup>()
  const singles: Comic[] = []

  for (const c of allComics) {
    // 批量导入的漫画以 batchSource（来源文件夹）为聚合键；
    // 没有 batchSource 的旧数据退回到 batchId，保证兼容性。
    const key = c.batchSource || c.batchId
    if (key) {
      let g = sourceMap.get(key)
      if (!g) {
        g = { batchSource: c.batchSource || c.batchId || '', items: [], allHidden: true }
        sourceMap.set(key, g)
      }
      g.items.push(c)
      if (!c.hidden) g.allHidden = false
    } else {
      singles.push(c)
    }
  }

  const batches = Array.from(sourceMap.values())
  batches.sort((a, b) => a.batchSource.localeCompare(b.batchSource, 'zh'))
  singles.sort((a, b) => a.title.localeCompare(b.title, 'zh'))

  return { batches, singles }
}

function AppInner() {
  const [currentView, setCurrentView] = useState<ViewType>('library')
  const [isImmersive, setIsImmersive] = useState(false)
  const [homeView, setHomeView] = useState<ViewType>('library')
  const [reading, setReading] = useState<LoadedComic | null>(null)
  const [initialPage, setInitialPage] = useState(0)
  // 设置模态框（替换原 settings 视图）
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ═══ 阅读器加载态 ═══
  const [loading, setLoading] = useState<{ id: string; title: string; cover?: string } | null>(null)
  // 永远指向最新 loading 的 ref（用于 handleOpenComic / handleCancelLoading 内部闭包不陈旧）
  const loadingRef = useRef<{ id: string; title: string; cover?: string } | null>(null)
  useEffect(() => { loadingRef.current = loading }, [loading])

  const loadTokenRef = useRef<{ canceled: boolean; id: string; seq: number; openAt: number } | null>(null)
  // 单调递增的打开序号：每次打开 +1；取消则清空当前序号并把 id 加入 canceledIds，双重保险
  const loadSeqRef = useRef(0)
  const canceledIdsRef = useRef<Set<string>>(new Set())
  // id → 最近一次 cancel 的时间戳（毫秒）。10 分钟内命中即视为"不应打开"的 Gate。
  const cancelAtByIdRef = useRef<Record<string, number>>({})
  const CANCEL_GRACE_MS = 10 * 60 * 1000
  const loaderWrapRef = useRef<HTMLDivElement>(null)

  const { showConfirm, showToast } = useToast()
  const { settings: homeSettings } = useHomeSettings()

  const {
    comics,
    allComics,
    loadingSource,
    isRefreshing,
    refreshAll,
    clearAllData,
    importFromFolder,
    importFromFile,
    importFromSource,
    loadComicForReading,
    markProgress,
    clearFromRecent,
    changeCover,
    removeComic,
    toggleHidden,
    toggleBatchHidden,
    removeBatch,
    isDemo,
    initialized: libraryInitialized
  } = useComicLibrary()

  // ═══ 导入界面：拖拽导入 ═══
  const dragDepthRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const dropHasFiles = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('Files')

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!dropHasFiles(e)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setIsDragging(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dropHasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!dropHasFiles(e)) return
    e.preventDefault()
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!dropHasFiles(e)) return
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)

    const files = e.dataTransfer.files
    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const p = (files[i] as unknown as { path?: string }).path
      if (p) paths.push(p)
    }
    if (paths.length === 0) {
      showToast(
        isDemo
          ? '演示模式下浏览器无法访问本地文件，请运行 npm run electron:dev 使用拖拽导入。'
          : '未识别到可导入的内容，请将漫画文件或文件夹拖入窗口。',
        'warning'
      )
      return
    }
    // 逐个导入（importFromSource 内部已处理成功/失败提示与去重）
    void (async () => {
      for (const p of paths) {
        await importFromSource(p)
      }
    })()
  }, [importFromSource, isDemo, showToast])

  const handleFirstViewChange = useCallback((view: ViewType) => {
    setHomeView(view)
  }, [])

  const handleOpenComic = useCallback(async (id: string) => {
    // 如果同一本正在加载，忽略重复点击（用 ref 拿最新值，避免 stale closure）
    if (loadingRef.current && loadingRef.current.id === id) return

    // 如果上一次打开的这本正在"已取消但仍在后台IPC执行" — 清掉 cancel 标记让这次能正常打开（但保留时间戳 gate 防止旧 IPC 误开）
    canceledIdsRef.current.delete(id)
    // 更新 cancel 时间戳：如果 cancelAtByIdRef 里有最近 10 分钟内的旧取消记录，清掉（因为用户明确重新打开了这本）
    const now = Date.now()
    if ((cancelAtByIdRef.current[id] ?? 0) > now - CANCEL_GRACE_MS) {
      delete cancelAtByIdRef.current[id]
    }

    const target = allComics.find((c) => c.id === id)
    const seq = ++loadSeqRef.current
    const openAt = now
    const token = { canceled: false, id, seq, openAt }
    loadTokenRef.current = token
    const newLoading = {
      id,
      title: target?.title ?? '正在加载…',
      cover: target?.coverPath ?? target?.coverDataUrl
    }
    loadingRef.current = newLoading
    setLoading(newLoading)
    try {
      const loaded = await loadComicForReading(id)
      // ═══════════════════════════════════════════════════
      // 五重校验 Gate（所有 state 读取都用 ref，绝对避免 stale closure）
      //   ① token.canceled = true（用户点了返回 / Esc / capture 兜底）
      //   ② 序列号不匹配（用户取消后又重新打开了另一本，seq 前进，旧 IPC 作废）
      //   ③ id 被加入 canceledIds（取消时写入的全局集合）
      //   ④ 取消时间戳晚于本次打开时刻（用户在 openAt 之后点过返回）→ 最近 10 分钟内有效
      //   ⑤ 当前 loading.id 必须匹配（用户取消后 loading 被新的/清掉了，旧 IPC 不应打开）
      // ═══════════════════════════════════════════════════
      if (token.canceled) return
      if (loadSeqRef.current !== seq) return
      if (canceledIdsRef.current.has(id)) return
      const now2 = Date.now()
      const cancelAt = cancelAtByIdRef.current[id] ?? 0
      if (cancelAt >= openAt && cancelAt >= now2 - CANCEL_GRACE_MS) return
      const latestLoading = loadingRef.current
      if (!latestLoading || latestLoading.id !== id) return
      if (!loaded) return

      const rawProgress = Number.isFinite(loaded.comic.progress) ? loaded.comic.progress : 0
      // 修复：markProgress 保存的是 (pageIndex + 1) / total，恢复时应使用 round(total * p) - 1。
      // 原 Math.floor 会导致第 1 页恢复成第 2 页、且浮点误差下时前时后。
      const start = loaded.comic.pageCount > 0
        ? Math.max(0, Math.min(loaded.comic.pageCount - 1, Math.round(rawProgress * loaded.comic.pageCount) - 1))
        : 0
      setInitialPage(start)
      setReading(loaded)
    } finally {
      // 仅当"仍在执行当前令牌"时才清理状态
      if (loadTokenRef.current === token) {
        loadTokenRef.current = null
        // 若非取消路径，确保 loading 清理
        if (!token.canceled && loadSeqRef.current === seq) {
          loadingRef.current = null
          setLoading(null)
        }
      }
      // 异步生命周期结束：从 canceled 集合移除（防止永久占用集合内存）
      canceledIdsRef.current.delete(id)
      // 清理 cancelAtByIdRef 中超过 10 分钟的旧记录（防止内存无限增长）
      const cleanupThreshold = Date.now() - CANCEL_GRACE_MS
      for (const k of Object.keys(cancelAtByIdRef.current)) {
        if ((cancelAtByIdRef.current[k] ?? 0) < cleanupThreshold) delete cancelAtByIdRef.current[k]
      }
    }
  }, [allComics, loadComicForReading, CANCEL_GRACE_MS])

  const handleCancelLoading = useCallback(() => {
    const token = loadTokenRef.current
    const id = token?.id ?? loadingRef.current?.id
    if (token) token.canceled = true
    if (id) {
      canceledIdsRef.current.add(id)
      cancelAtByIdRef.current[id] = Date.now()
    }
    loadTokenRef.current = null
    loadingRef.current = null
    setLoading(null)
  }, [])

  const handleCloseReader = useCallback(() => {
    setReading(null)
  }, [])

  const handleViewChange = useCallback((v: ViewType) => {
    if (v === 'settings') {
      setSettingsOpen(true)
    } else {
      setCurrentView(v)
    }
  }, [])

  const handleAllDataCleared = useCallback(async () => {
    // 清空所有本地数据（磁盘 + 内存 + localStorage），等待完成后再关闭弹窗
    await clearAllData()
  }, [clearAllData])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const popover = document.getElementById('import-info-popover')
      const wrap = popover?.parentElement
      if (!popover || !wrap) return
      if (!wrap.contains(e.target as Node)) {
        popover.classList.remove('import-info-visible')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // 关闭窗口前立即刷盘，避免进度写入因 120ms 缓冲未落盘而丢失
  useEffect(() => {
    const onBeforeUnload = () => {
      flushPendingWrites()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Esc 打断阅读器加载 + capture 级 mousedown 兜底（防止 app-region drag 吞掉"返回"按钮点击）
  useEffect(() => {
    if (!loading) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handleCancelLoading() }
    }
    // capture 阶段兜底 1：点击 target 为 .reader-loader-back 或其子节点 → 取消
    // capture 阶段兜底 2：若当前显示 loading 且坐标命中返回按钮在屏幕中的像素区域 → 也取消（防止 closest 因合成层/Shadow DOM 失效）
    const onMouseDownCapture = (e: MouseEvent) => {
      // 1. closest 命中
      const target = e.target as Node | null
      if (target) {
        const btn = (target as HTMLElement).closest?.('.reader-loader-back') as HTMLElement | null
        if (btn) {
          e.preventDefault(); e.stopPropagation(); handleCancelLoading(); return
        }
      }
      // 2. 屏幕坐标兜底：按钮位置固定（left 16px, top 14px, height 34px，宽度约 = 内容 60~100px）
      //    用 loaderWrapRef（固定定位全屏）的 getBoundingClientRect 作为视口基准
      const wrap = loaderWrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // 保险命中框：左 0~180px，上 0~64px（按钮的 ~2 倍面积安全区）
      if (x >= -20 && x <= 200 && y >= -10 && y <= 68) {
        e.preventDefault()
        e.stopPropagation()
        handleCancelLoading()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDownCapture, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDownCapture, true)
    }
  }, [loading, handleCancelLoading])

  const handlePageChange = useCallback((pageIndex: number) => {
    if (reading) {
      markProgress(reading.comic.id, pageIndex, reading.comic.pageCount)
    }
  }, [reading, markProgress])

  const { batches, singles } = useMemo(() => groupComics(allComics), [allComics])

  return (
    <div className="app-container">
      {!reading && !isImmersive && (
        <TitleBar onEnterImmersive={() => setIsImmersive(true)} onGoHome={() => setCurrentView(homeView)} />
      )}
      {/* ═══ 加载中：覆盖全屏，左上角可打断返回 ═══ */}
      {loading && !reading && (
        <div className="reader-loader-wrap" ref={loaderWrapRef} role="dialog" aria-label="加载中">
          {/* 加载背景：复用主页悬停剪影同一套机制，显示对应漫画封面虚化背景 */}
          <BackdropLayer comic={allComics.find((c) => c.id === loading.id) ?? null} />
          <button
            className="reader-loader-back"
            type="button"
            title="取消加载 (Esc)"
            // 同时挂 onMouseDown + onClick；onMouseDown 保证即使 onClick 被 drag/合成层吞掉也能取消
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCancelLoading() }}
            onClick={(e) => { e.preventDefault(); handleCancelLoading() }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>返回</span>
          </button>
          <div className="reader-loader-inner">
            <div className="reader-loader-spinner" aria-hidden="true">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="2" opacity="0.12" />
                <path d="M52 28a24 24 0 0 0-24-24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <animateTransform
                    attributeName="transform" type="rotate"
                    from="0 28 28" to="360 28 28" dur="1s" repeatCount="indefinite" />
                </path>
              </svg>
            </div>
            <div className="reader-loader-title">{loading.title}</div>
            <div className="reader-loader-sub">正在准备内容…</div>
          </div>
        </div>
      )}
      {reading ? (
        <ComicReader
          key={reading.comic.id}
          title={reading.comic.title}
          pageCount={reading.comic.pageCount}
          sourcePath={reading.comic.sourcePath}
          onClose={handleCloseReader}
          initialPage={initialPage}
          comics={comics}
          currentComicId={reading.comic.id}
          onOpenComic={handleOpenComic}
          onPageChange={handlePageChange}
          alwaysShowDebugPanel={homeSettings.alwaysShowDebugPanel}
        />
      ) : (
        <div className="app-body">
          <Sidebar
            currentView={currentView}
            onViewChange={handleViewChange}
            isImmersive={isImmersive}
            onExitImmersive={() => setIsImmersive(false)}
            onFirstViewChange={handleFirstViewChange}
            settingsOpen={settingsOpen}
          />
          <main className="app-main">
            {currentView === 'library' && (
              <Library
                comics={comics}
                onOpenComic={handleOpenComic}
                onRequestImport={() => handleViewChange('import')}
                onChangeCover={changeCover}
                onRemoveComic={removeComic}
                onRefreshAll={refreshAll}
                isRefreshing={isRefreshing}
                isLoading={!libraryInitialized}
              />
            )}
            {currentView === 'recent' && (
              <RecentReading
                comics={comics}
                onOpenComic={handleOpenComic}
                onRequestImport={() => handleViewChange('library')}
                onClearFromRecent={clearFromRecent}
              />
            )}
            {currentView === 'search' && (
              <Search
                comics={comics}
                onOpenComic={handleOpenComic}
                onChangeCover={changeCover}
                onRemoveComic={removeComic}
              />
            )}
            {currentView === 'import' && (
              <div
                className={`import-view${isDragging ? ' is-dragging' : ''}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isDragging && (
                  <div className="import-drop-overlay">
                    <div className="import-drop-inner">
                      <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                        <path d="M12 16V4m0 0L7 9m5-5l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div className="import-drop-text">将漫画文件或文件夹拖到此处导入</div>
                      <div className="import-drop-hint">支持 CBZ / ZIP / PDF / EPUB 及图片文件夹等</div>
                    </div>
                  </div>
                )}
                <CustomScrollbar contentClassName="import-view-scroll">
                  <div className="import-view-header">
                  <div className="import-view-title-row">
                    <div>
                      <h2 className="import-view-title">导入漫画</h2>
                      <p className="import-view-desc">选择本地文件夹或单个漫画文件添加到书库，也可以直接把文件拖进窗口</p>
                    </div>
                    <div className="import-info-wrap">
                      <button
                        className="import-info-icon"
                        onClick={() => {
                          const el = document.getElementById('import-info-popover')
                          if (el) el.classList.toggle('import-info-visible')
                        }}
                        title="查看支持的格式"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                          <line x1="12" y1="10" x2="12" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <circle cx="12" cy="7.5" r="1" fill="currentColor" />
                        </svg>
                      </button>
                      <div id="import-info-popover" className="import-info-popover">
                        <div className="import-info-popover-title">支持的漫画格式</div>
                        <div className="import-info-section">
                          <div className="import-info-section-title">归档压缩包</div>
                          <div className="import-formats">
                            <span className="import-format-tag">CBZ / ZIP</span>
                            <span className="import-format-tag">CBR / RAR</span>
                            <span className="import-format-tag">CB7 / 7Z</span>
                            <span className="import-format-tag">CBT / TAR</span>
                          </div>
                        </div>
                        <div className="import-info-section">
                          <div className="import-info-section-title">文档格式</div>
                          <div className="import-formats">
                            <span className="import-format-tag">PDF</span>
                            <span className="import-format-tag">EPUB</span>
                            <span className="import-format-tag">FB2</span>
                          </div>
                        </div>
                        <div className="import-info-section">
                          <div className="import-info-section-title">图片格式</div>
                          <div className="import-formats">
                            <span className="import-format-tag">JPG</span>
                            <span className="import-format-tag">PNG</span>
                            <span className="import-format-tag">WEBP</span>
                            <span className="import-format-tag">AVIF</span>
                            <span className="import-format-tag">BMP</span>
                            <span className="import-format-tag">GIF</span>
                            <span className="import-format-tag">TIFF</span>
                          </div>
                        </div>
                        <div className="import-info-section">
                          <div className="import-info-section-title">文件夹漫画</div>
                          <div className="import-formats">
                            <span className="import-format-tag">图片文件夹</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="import-view-actions">
                  <button
                    className="import-card"
                    onClick={() => importFromFolder()}
                    disabled={!!loadingSource}
                  >
                    <div className="import-card-icon">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <line x1="9" y1="14" x2="15" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="import-card-text">
                      <div className="import-card-title">导入漫画文件夹</div>
                      <div className="import-card-hint">扫描文件夹内的所有漫画（压缩包 / 图片文件夹）</div>
                    </div>
                  </button>
                  <button
                    className="import-card"
                    onClick={() => importFromFile()}
                    disabled={!!loadingSource}
                  >
                    <div className="import-card-icon">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                        <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="import-card-text">
                      <div className="import-card-title">打开漫画文件</div>
                      <div className="import-card-hint">选择单个 CBZ / ZIP / PDF / EPUB 等文件</div>
                    </div>
                  </button>
                </div>
                {loadingSource && (
                  <div className="import-loading">
                    <div className="import-loading-spinner" />
                    <span>正在导入：{loadingSource}</span>
                  </div>
                )}

                {/* 已导入管理列表 */}
                <div className="import-section">
                  <div className="import-section-header">
                    <h3 className="import-section-title">已导入 ({allComics.length})</h3>
                  </div>
                  {allComics.length === 0 ? (
                    <div className="import-empty">尚未导入任何漫画</div>
                  ) : (
                    <CustomScrollbar className="import-manage-scroll" contentClassName="import-manage-list">
                      {/* 文件夹批量导入 */}
                      {batches.map((g) => (
                        <div key={g.batchSource} className={`import-manage-item import-manage-item-group ${g.allHidden ? 'is-hidden' : ''}`}>
                          <div className="import-manage-thumb import-manage-thumb-folder">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                            </svg>
                          </div>
                          <div className="import-manage-info">
                            <div className="import-manage-title" title={g.batchSource}>
                              {getBasename(g.batchSource)}
                            </div>
                            <div className="import-manage-meta">
                              {g.allHidden && <span className="import-manage-hidden-tag">已隐藏</span>}
                              <span>{g.items.length} 本漫画</span>
                              <span className="import-manage-path" title={g.batchSource}>
                                {g.batchSource}
                              </span>
                            </div>
                          </div>
                          <div className="import-manage-actions">
                            <button
                              className={`import-manage-btn ${g.allHidden ? 'is-active' : ''}`}
                              onClick={() => toggleBatchHidden(g.batchSource)}
                              title={g.allHidden ? '在书库中显示全部' : '在书库中隐藏全部'}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                {g.allHidden ? (
                                  <>
                                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" strokeWidth="1.5" />
                                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                                  </>
                                ) : (
                                  <>
                                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.9 19.9 0 0 1 5.17-5.94" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.9 19.9 0 0 1-3.17 4.19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                  </>
                                )}
                              </svg>
                            </button>
                            <button
                              className="import-manage-btn import-manage-btn-danger"
                              onClick={async () => {
                                const ok = await showConfirm({
                                  title: '确认移除',
                                  message: `确认移除文件夹「${g.batchSource}」中的 ${g.items.length} 本漫画？`,
                                  confirmText: '移除',
                                  cancelText: '取消',
                                  dismissibleId: 'remove-batch'
                                })
                                if (ok) removeBatch(g.batchSource)
                              }}
                              title="移除整个文件夹"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M3 6h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* 单个文件导入 */}
                      {singles.map((c) => (
                        <div key={c.id} className={`import-manage-item ${c.hidden ? 'is-hidden' : ''}`}>
                          <div className="import-manage-thumb">
                            <CoverResolver comic={c}>
                              {(src) => src ? (
                                <img src={src} alt="" draggable={false} />
                              ) : (
                                <div className="import-manage-thumb-placeholder">
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                                    <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                                    <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </div>
                              )}
                            </CoverResolver>
                          </div>
                          <div className="import-manage-info">
                            <div className="import-manage-title" title={c.title}>{c.title}</div>
                            <div className="import-manage-meta">
                              {c.hidden && <span className="import-manage-hidden-tag">已隐藏</span>}
                              <span>{c.pageCount} 页</span>
                              {c.isFolder && <span className="import-manage-folder-tag">{c.fileType || '文件夹'}</span>}
                              {c.sourcePath && (
                                <span className="import-manage-path" title={c.sourcePath}>
                                  {c.sourcePath}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="import-manage-actions">
                            <button
                              className={`import-manage-btn ${c.hidden ? 'is-active' : ''}`}
                              onClick={() => toggleHidden(c.id)}
                              title={c.hidden ? '在书库中显示' : '在书库中隐藏'}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                {c.hidden ? (
                                  <>
                                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" strokeWidth="1.5" />
                                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                                  </>
                                ) : (
                                  <>
                                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.9 19.9 0 0 1 5.17-5.94" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.9 19.9 0 0 1-3.17 4.19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                  </>
                                )}
                              </svg>
                            </button>
                            <button
                              className="import-manage-btn import-manage-btn-danger"
                              onClick={async () => {
                                const ok = await showConfirm({
                                  title: '确认移除',
                                  message: `确认移除「${c.title}」？`,
                                  confirmText: '移除',
                                  cancelText: '取消',
                                  dismissibleId: 'remove-comic'
                                })
                                if (ok) removeComic(c.id)
                              }}
                              title="从书库移除"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M3 6h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </CustomScrollbar>
                  )}
                </div>

                {isDemo && (
                  <p className="placeholder-hint">
                    演示模式下浏览器无法访问本地文件系统。请运行 <code>npm run electron:dev</code> 使用导入功能。
                  </p>
                )}
                </CustomScrollbar>
              </div>
            )}
          </main>
        </div>
      )}
      {/* 设置模态框 */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAllDataCleared={handleAllDataCleared}
      />
    </div>
  )
}

function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}

export default App
