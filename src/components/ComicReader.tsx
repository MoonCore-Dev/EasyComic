import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import type { ComicPage } from '../vite-env.d'
import type { Comic } from '../types/comic'
import { useReaderSettings, type ReaderUpdateFn } from '../comic/useReaderSettings'
import { useAutoPlaySettings } from '../comic/useAutoPlaySettings'
import { CoverResolver } from './CoverResolver'
import { createDemoPage } from '../comic/useComicLibrary'
import CustomScrollbar from './CustomScrollbar'
import './ComicReader.css'

// ─── Props ───
interface ComicReaderProps {
  title: string
  /** 总页数（阅读器按此渲染进度与窗口，逐页自行向主进程请求） */
  pageCount: number
  /** 漫画源路径（传给 comic:loadPage） */
  sourcePath: string
  onClose: () => void
  initialPage?: number
  /** 全部漫画列表（用于快速换书） */
  comics: Comic[]
  /** 当前漫画 ID */
  currentComicId: string
  /** 切换到指定漫画 */
  onOpenComic: (id: string) => void
  /** 页码变更回调（用于保存进度） */
  onPageChange?: (pageIndex: number) => void
  /** 是否始终显示诊断面板（通用设置） */
  alwaysShowDebugPanel?: boolean
}

// ─── 点击区域判定常量 ───
const PAGE_TURN_X = 0.32

type ClickZone = 'center' | 'left' | 'right' | 'dead'

function getClickZone(xRatio: number, _yRatio: number): ClickZone {
  if (xRatio < PAGE_TURN_X) return 'left'
  if (xRatio > 1 - PAGE_TURN_X) return 'right'
  return 'center'
}

/** 加载失败/占位页（SVG） */
function placeholderDataUrl(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200">
    <rect width="800" height="1200" fill="#2A2A2E"/>
    <text x="400" y="600" text-anchor="middle" font-size="22" fill="#888">加载失败</text>
    <text x="400" y="640" text-anchor="middle" font-size="13" fill="#666">${name}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// ─── 单页插槽：已加载显示图片，未加载显示占位，失败可点击重试 ───
const PageSlot = memo(function PageSlot({ dataUrl, index, name, zoom, isStitch, fill, failed, onRetry, onImgLoad, slotHeight, showImage }: {
  dataUrl: string | null
  index: number
  name: string
  zoom: number
  isStitch: boolean
  fill?: 'contain' | 'cover'
  failed?: boolean
  onRetry?: (index: number) => void
  onImgLoad?: () => void
  /** 拼接模式每页固定高度（px），占位/加载/失败完全一致，杜绝加载时布局漂移 */
  slotHeight?: number
  /** 拼接模式：是否挂载 <img>（视口外不挂载，限流） */
  showImage?: boolean
}) {
  if (isStitch) {
    const h = slotHeight ? `${slotHeight}px` : undefined
    const style: React.CSSProperties = { width: `${zoom * 100}%`, height: h, flexShrink: 0 }
    if (!showImage) {
      // 视口外：仅占位骨架，不挂载 img（限流，避免切模式卡顿 / 内存膨胀）
      return <div className="reader-stitch-page" style={style} />
    }
    if (failed) {
      return <div className="reader-stitch-failed" style={style} onClick={() => onRetry?.(index)}><span>加载失败，点击重试</span></div>
    }
    if (!dataUrl) {
      return <div className="reader-stitch-placeholder" style={style}><span>加载中…</span></div>
    }
    return (
      <div className="reader-stitch-page" style={style}>
        <img className="reader-stitch-img" src={dataUrl} alt={name} draggable={false} decoding="async" onLoad={onImgLoad} />
      </div>
    )
  }
  if (!dataUrl) {
    return (
      <div className="reader-page-img reader-page-placeholder" style={{ transform: `scale(${zoom})` }}>
        <span>加载中…</span>
      </div>
    )
  }
  // 加载失败：显示可点击重试（而非无限转圈 / 无信息占位）
  if (failed) {
    return (
      <div className="reader-page-img reader-page-failed" style={{ transform: `scale(${zoom})` }} onClick={() => onRetry?.(index)}>
        <span>加载失败，点击重试</span>
      </div>
    )
  }
  const fillClass = fill === 'cover' ? 'reader-page-img-cover' : ''
  return <img className={`reader-page-img ${fillClass}`} src={dataUrl} alt={name} draggable={false} decoding="async" style={{ transform: `scale(${zoom})` }} />
})

// ═══════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════
// ═════════════════════════════════════════
// 拼接模式滚动控制器
// ───────────────────────────────────────────
// 完全用 JS 接管滚动：位移通过 transform:translateY 施加（GPU 加速），
// 不再使用浏览器原生 scrollTop / scroll 事件。
// 核心三状态：translateY（当前偏移）、velocity（速度/惯性来源）、targetY（程序化缓动目标）。
// 每帧用 requestAnimationFrame 积分：位置随速度推进，速度按摩擦衰减；
// 越界时施加弹性回正力形成"拉伸→回弹"。触控板与鼠标滚轮统一走 wheel → 累加 velocity。
// ═════════════════════════════════════════

interface StitchScrollerOptions {
  /** 需要位移的包裹层（.reader-stitch-inner） */
  inner: HTMLElement
  /** 每帧回调：对外同步滚动条 / 进度条 / 页码（参数为 pos 与 maxScroll） */
  onFrame: (pos: number, maxScroll: number) => void
}

interface StitchScroller {
  /** 滚轮：累加速度形成惯性（deltaY 像素增量） */
  wheel(deltaY: number): void
  /** 匀速推进（自动连播逐帧一小段） */
  scrollBy(px: number): void
  /** 立即定位（进入漫画 / 换书 / 翻页），无缓动 */
  scrollToImmediate(pos: number): void
  /** 缓动定位（跳转页码 / 滚动条轨道点击） */
  scrollToPosition(pos: number): void
  /** 滚动条拖拽：按 ratio 即时定位 */
  dragThumbToRatio(ratio: number): void
  /** 内容高度 / 视口高度变化时更新指标（自动夹紧位置） */
  setMetrics(contentHeight: number, viewportHeight: number): void
  /** 直接设置偏移（缩放按比例锚定时使用） */
  setTranslateY(v: number): void
  /** 当前已滚动距离 */
  getPos(): number
  /** 可滚动最大距离 */
  getMaxScroll(): number
  /** 卸载时取消动画帧 */
  destroy(): void
}

function createStitchScroller(opts: StitchScrollerOptions): StitchScroller {
  const { inner, onFrame } = opts

  // ── 状态 ──
  // translateY：当前垂直偏移。0 = 顶部；负值 = 已向下滚动。直接对应 inner 的 transform。
  let translateY = 0
  // velocity：当前速度（px/帧）。惯性滚动的来源——每帧位置 += velocity，速度按摩擦衰减。
  let velocity = 0
  // targetY：程序化滚动（跳转 / 翻页 / seek）的目标偏移；非 null 时走缓动分支而非惯性。
  let targetY: number | null = null

  let contentHeight = 0
  let viewportHeight = 0
  let rafId = 0

  // ── 可调参数（手感集中在此）──
  const FRICTION = 0.92    // 摩擦系数：每帧速度 ×0.92（每帧衰减 8%，比 0.95 停得更利落）
  const STOP_VEL = 0.1     // 速度低于此值且在区间内则停机，避免空转
  // 边界处理：到达顶/底即硬停，不做越界拉伸与回弹（无橡皮筋）
  const WHEEL_GAIN = 0.1   // 滚轮冲量增益：单格位移 ≈ GAIN*deltaY/(1-FRICTION)；0.1+0.92≈125px/格，滑行约 0.9s
  const EASE = 0.25        // 程序化滚动缓动系数（每帧逼近目标的百分比）
  const MAX_V = 240        // 速度安全上限，防止极端触控板甩动导致飞出

  const maxScroll = () => Math.max(0, contentHeight - viewportHeight)

  // 把当前 translateY 写到 DOM（translate3d 触发 GPU 合成层），并通知外层同步 UI
  const render = () => {
    inner.style.transform = `translate3d(0, ${translateY}px, 0)`
    // 对外用 pos（已滚动距离，0..maxScroll）便于计算页码与滚动条比例
    onFrame(-translateY, maxScroll())
  }

  // 动画主循环：每帧积分速度→位置，施加摩擦与弹性边界
  const loop = () => {
    rafId = 0
    const mx = maxScroll()

    if (targetY !== null) {
      // 程序化缓动：平滑逼近目标位置（用于跳转 / 翻页 / 进度条 seek）
      const diff = targetY - translateY
      translateY += diff * EASE
      velocity = 0
      if (Math.abs(diff) < 0.5) {
        translateY = targetY
        targetY = null
      }
      // 缓动目标本身已夹在合法区间，这里兜底防止越界
      translateY = Math.max(-mx, Math.min(0, translateY))
      render()
      if (targetY === null) return   // 已到位，停机
      rafId = requestAnimationFrame(loop)
      return
    }

    // 惯性阶段：位置随速度推进，速度按摩擦衰减
    translateY += velocity
    velocity *= FRICTION

    // 硬边界：到达顶(0)或底(-mx)立刻停住，不做任何越界拉伸与回弹（无橡皮筋）
    if (translateY > 0) {
      translateY = 0
      velocity = 0
    } else if (translateY < -mx) {
      translateY = -mx
      velocity = 0
    }

    render()

    // 停机条件：在合法区间内且速度极小
    if (Math.abs(velocity) < STOP_VEL && translateY >= -mx && translateY <= 0) {
      velocity = 0
      translateY = Math.max(-mx, Math.min(0, translateY))
      render()
      return
    }
    rafId = requestAnimationFrame(loop)
  }

  const start = () => {
    if (rafId !== 0) return
    rafId = requestAnimationFrame(loop)
  }

  const clampPos = (pos: number) => Math.max(0, Math.min(maxScroll(), pos))

  return {
    // 滚轮：累加速度形成惯性。符号说明：滚轮向下(deltaY>0)应"向下滚动看后续页"，
    // 即 translateY 变负，故 velocity 取 -deltaY*GAIN。触控板双指滑动同理（deltaY 连续）。
    wheel(deltaY: number) {
      targetY = null
      velocity += -deltaY * WHEEL_GAIN
      velocity = Math.max(-MAX_V, Math.min(MAX_V, velocity))
      start()
    },
    // 自动连播：按固定像素匀速推进（每帧一小段），到达底部由调用方停止
    scrollBy(px: number) {
      targetY = null
      velocity = 0
      translateY = Math.max(-maxScroll(), translateY - px)
      render()
    },
    // 立即定位（进入漫画 / 换书 / 翻页）：无动画
    scrollToImmediate(pos: number) {
      targetY = null
      velocity = 0
      translateY = -clampPos(pos)
      render()
    },
    // 缓动定位（跳转页码 / 滚动条轨道点击）
    scrollToPosition(pos: number) {
      targetY = -clampPos(pos)
      velocity = 0
      start()
    },
    // 滚动条拖拽：按 ratio 即时定位
    dragThumbToRatio(ratio: number) {
      targetY = null
      velocity = 0
      translateY = -clampPos(ratio * maxScroll())
      render()
    },
    setMetrics(ch: number, vh: number) {
      contentHeight = Math.max(1, ch)
      viewportHeight = Math.max(1, vh)
      // 内容 / 视口变化后，把当前位置夹回合法区间（缩放 / 换书安全）
      translateY = Math.max(-maxScroll(), Math.min(0, translateY))
      render()
    },
    setTranslateY(v: number) {
      translateY = Math.max(-maxScroll(), Math.min(0, v))
      render()
    },
    getPos() {
      return -translateY
    },
    getMaxScroll() {
      return maxScroll()
    },
    destroy() {
      if (rafId !== 0) cancelAnimationFrame(rafId)
      rafId = 0
      velocity = 0
      targetY = null
    }
  }
}

function ComicReader({
  title, pageCount, sourcePath, onClose, initialPage = 0,
  comics, currentComicId, onOpenComic, onPageChange,
  alwaysShowDebugPanel = false
}: ComicReaderProps) {
  const { settings, update, currentZoom, adjustZoom, resetZoom } = useReaderSettings()
  const {
    settings: autoPlaySettings,
    setPageFlipIntervalMs,
    setScrollSpeedPxPerSecond
  } = useAutoPlaySettings()
  // 自动连播：每次进入漫画默认关闭，速度值持久化
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false)
  const [autoPlayExpanded, setAutoPlayExpanded] = useState(false)
  const autoPlayTimerRef = useRef<number | null>(null)
  const lastAutoPlayTickRef = useRef<number>(0)

  const isJapanese = settings.pageOrder === 'japanese'
  const zoom = currentZoom

  // ─── 懒加载：用 ref 缓存页面 base64，tick 强制刷新，避免 React state 闭包/批处理陷阱 ───
  const w = window as any
  const api = w.electronAPI?.comic ?? null
  const isDemo = !api
  const comic = comics.find((c) => c.id === currentComicId)

  const pagesDataRef = useRef<(string | null)[]>([])
  const inFlightRef = useRef<Set<number>>(new Set())
  const failedRef = useRef<Set<number>>(new Set())
  const cancelledRef = useRef(false)
  const [tick, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick((v) => v + 1), [])

  // 加载失败的页集合（用于显示"点击重试"，避免永久停在加载中）
  const [failedTick, setFailedTick] = useState(0)
  const refreshFailed = useCallback(() => setFailedTick((v) => v + 1), [])

  // 调试面板：默认隐藏，加载失败时自动出现，也可在通用设置中常显
  const [debugPanel, setDebugPanel] = useState(false)
  const [lastResult, setLastResult] = useState<{ index: number; len: number; time: number } | null>(null)
  const [lastError, setLastError] = useState<{ index: number; msg: string; time: number } | null>(null)
  const debugRevealTimerRef = useRef<number | null>(null)

  // 用 ref 缓存会传给 loadPageData 的引用不稳定值
  const apiRef = useRef(api)
  apiRef.current = api
  const sourcePathRef = useRef(sourcePath)
  sourcePathRef.current = sourcePath
  const pageCountRef = useRef(pageCount)
  pageCountRef.current = pageCount
  const settingsModeRef = useRef(settings.mode)
  settingsModeRef.current = settings.mode
  const isDemoRef = useRef(isDemo)
  isDemoRef.current = isDemo
  const comicRef = useRef(comic)
  comicRef.current = comic
  const titleRef = useRef(title)
  titleRef.current = title

  // pageCount 变化时安全地调整数组长度（放在 effect 中，避免渲染期间副作用）
  useEffect(() => {
    if (pagesDataRef.current.length !== pageCount) {
      const n = new Array(Math.max(0, pageCount)).fill(null)
      for (let i = 0; i < Math.min(pagesDataRef.current.length, n.length); i++) n[i] = pagesDataRef.current[i]
      pagesDataRef.current = n
      forceUpdate()
    }
  }, [pageCount, forceUpdate])

  // StrictMode 会 double-invoke effects：模拟 unmount 时把 cancelledRef 设为 true，
  // 若 ref 值被保留则后续加载结果会被丢弃。因此在 mount 时显式重置为 false。
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      if (debugRevealTimerRef.current !== null) {
        window.clearTimeout(debugRevealTimerRef.current)
        debugRevealTimerRef.current = null
      }
    }
  }, [])

  const loadPageData = useCallback((index: number, force = false): Promise<void> => {
    const pc = pageCountRef.current
    const src = sourcePathRef.current
    const demo = isDemoRef.current
    const a = apiRef.current
    const c = comicRef.current
    const t = titleRef.current
    if (index < 0 || index >= pc) return Promise.resolve()
    if (!force && pagesDataRef.current[index]) return Promise.resolve()
    if (inFlightRef.current.has(index)) return Promise.resolve()
    inFlightRef.current.add(index)
    const run = async () => {
      let attempts = 0
      const maxAttempts = 2
      while (attempts < maxAttempts) {
        attempts++
        try {
          let dataUrl: string | null
          if (demo) {
            dataUrl = createDemoPage(c?.title ?? t, index + 1, pc, c?.coverDataUrl)
          } else {
            const timeout = new Promise<ComicPage | null>((_, reject) =>
              setTimeout(() => reject(new Error('加载超时（10s）')), 10000)
            )
            const page = await Promise.race([a.loadPage(src, index), timeout])
            dataUrl = page?.dataUrl ?? null
            if (!demo && dataUrl) {
              setLastResult({ index, len: dataUrl.length, time: Date.now() })
            }
          }
          if (cancelledRef.current) return
          if (pagesDataRef.current[index] !== dataUrl) {
            pagesDataRef.current[index] = dataUrl
            forceUpdate()
          }
          if (dataUrl && failedRef.current.has(index)) {
            failedRef.current.delete(index)
            refreshFailed()
          }
          return
        } catch (err: any) {
          if (cancelledRef.current) return
          console.error(`[EasyComic][reader] loadPageData error idx=${index}:`, err?.message ?? err)
          if (attempts >= maxAttempts) {
            const msg = err?.message ?? String(err)
            setLastError({ index, msg, time: Date.now() })
            // 加载失败时自动显示诊断面板，方便用户排查
            setDebugPanel(true)
            if (pagesDataRef.current[index] !== placeholderDataUrl(`page-${index + 1}`)) {
              pagesDataRef.current[index] = placeholderDataUrl(`page-${index + 1}`)
              forceUpdate()
            }
            if (!failedRef.current.has(index)) {
              failedRef.current.add(index)
              refreshFailed()
            }
          }
        }
      }
    }
    return run().finally(() => {
      inFlightRef.current.delete(index)
      forceUpdate()
    })
  }, [forceUpdate, refreshFailed])

  // 强制重新加载某一页（点击"加载失败·重试"时调用）
  const retryPage = useCallback((index: number) => {
    if (failedRef.current.has(index)) {
      failedRef.current.delete(index)
      refreshFailed()
    }
    loadPageData(index, true)
  }, [loadPageData, refreshFailed])

  // 预加载所有页：当前页优先，其余按距当前页距离并发加载。
  // 用户要求"每一页都能衔接顺畅"，因此默认预加载整本书，但保留按需 IPC 避免单条消息过大。
  const preloadTaskRef = useRef<Promise<void> | null>(null)
  const ensureWindow = useCallback((center: number) => {
    const pc = pageCountRef.current
    if (!Number.isFinite(center) || center < 0 || center >= pc) return
    if (preloadTaskRef.current) return
    preloadTaskRef.current = (async () => {
      // 优先加载当前页并等待完成，保证翻页后当前页立即可用。
      // 若当前页已加载且未失败，则不再强制重新请求（避免翻页时重复 IPC）。
      await loadPageData(center, failedRef.current.has(center))
      // 构造按距离排序的索引列表
      const order: number[] = []
      for (let d = 1; d < pc; d++) {
        if (center - d >= 0) order.push(center - d)
        if (center + d < pc) order.push(center + d)
      }
      // 并发控制：每次最多 3 个，避免 IPC 拥堵
      const CONCURRENCY = 3
      let i = 0
      const running = new Set<Promise<void>>()
      while (i < order.length || running.size > 0) {
        while (running.size < CONCURRENCY && i < order.length) {
          const idx = order[i++]
          const p = loadPageData(idx).finally(() => running.delete(p))
          running.add(p)
        }
        if (running.size > 0) {
          await Promise.race(running)
        }
      }
    })().finally(() => {
      preloadTaskRef.current = null
    })
  }, [loadPageData])

  // ─── 窗口控制按钮状态 ───
  const [isMaximized, setIsMaximized] = useState(false)
  const winApi = w.electronAPI?.window ?? w.windowAPI

  useEffect(() => {
    if (winApi) {
      winApi.isMaximized?.().then((maximized: boolean) => {
        setIsMaximized(maximized)
      })
    }
  }, [winApi])

  const handleMinimize = () => winApi?.minimize?.()
  const handleMaximize = () => {
    winApi?.maximize?.().then((result: boolean) => setIsMaximized(result))
  }
  const handleCloseWindow = () => winApi?.close?.()

  // ─── 状态 ───
  const [pageIndex, setPageIndex] = useState(() => {
    const safeInitial = Number.isFinite(initialPage) ? initialPage : 0
    return Math.min(Math.max(0, safeInitial), Math.max(0, pageCount - 1))
  })

  // 窗口随当前页变化而预取/释放（放在 pageIndex 声明之后，避免 TDZ 报错）
  useEffect(() => {
    ensureWindow(pageIndex)
  }, [pageIndex, ensureWindow])

  // 通用设置：常显诊断面板
  useEffect(() => {
    setDebugPanel(alwaysShowDebugPanel)
  }, [alwaysShowDebugPanel])

  // 当前页长时间未加载成功（5s 仍在请求且无数据）则自动显示诊断面板
  useEffect(() => {
    if (alwaysShowDebugPanel) return
    if (debugPanel) return
    if (pageCount === 0) return
    if (pagesDataRef.current[pageIndex]) return
    if (inFlightRef.current.size === 0 && failedRef.current.size === 0) return
    if (debugRevealTimerRef.current !== null) window.clearTimeout(debugRevealTimerRef.current)
    debugRevealTimerRef.current = window.setTimeout(() => {
      debugRevealTimerRef.current = null
      if (!pagesDataRef.current[pageIndex]) {
        setDebugPanel(true)
      }
    }, 5000)
    return () => {
      if (debugRevealTimerRef.current !== null) {
        window.clearTimeout(debugRevealTimerRef.current)
        debugRevealTimerRef.current = null
      }
    }
  }, [pageIndex, pageCount, alwaysShowDebugPanel, debugPanel])

  const [direction, setDirection] = useState(1) // 1=前进 -1=后退
  const [barsVisible, setBarsVisible] = useState(true)
  const [miniLibOpen, setMiniLibOpen] = useState(false)
  const [gridLibOpen, setGridLibOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // ═══ 页码跳转弹窗 ═══
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpValue, setJumpValue] = useState('')
  const jumpOpenRef = useRef(false)
  jumpOpenRef.current = jumpOpen
  const jumpPopoverRef = useRef<HTMLDivElement>(null)

  // 跳转弹窗打开时：点外部关闭，但不阻塞漫画区操作
  useEffect(() => {
    if (!jumpOpen) return
    const onDown = (e: MouseEvent) => {
      if (!jumpPopoverRef.current) return
      if (!jumpPopoverRef.current.contains(e.target as Node)) {
        setJumpOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [jumpOpen])
  // ═══ 缩放百分比气泡 ═══
  // zoomToast 只保存计时 token；百分比直接读实时 currentZoom（即下方 zoom 变量），
  // 保证中心气泡与设置栏显示的缩放值始终一致。
  const [zoomToast, setZoomToast] = useState<{ token: number } | null>(null)
  const zoomToastTimerRef = useRef<number | null>(null)
  const zoomTokenRef = useRef(0)

  // ─── Refs ───
  const pageRef = useRef(pageIndex)
  pageRef.current = pageIndex
  // 标记是否发生过「翻页」：仅真正翻页时播放翻页动效，进入漫画/换书时不播放（避免入场微幅抽动）
  const turnedRef = useRef(false)
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange
  const stitchRef = useRef<HTMLDivElement>(null)
  const stitchInnerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  // 拼接模式滚动控制器（JS 惯性滚动，挂载于 stitch 模式，卸载时销毁）
  const scrollerRef = useRef<StitchScroller | null>(null)
  // ═══ 自绘滚动条（绕过 Chromium/Win11 Fluent 滚动条无视 webkit CSS 的问题）
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const scrollbarThumbRef = useRef<HTMLDivElement>(null)
  const scrollbarStateRef = useRef({
    dragging: false,
    dragStartY: 0,
    dragStartTop: 0,
    trackHeight: 0,
    thumbHeight: 0
  })
  const [scrollbarIdle, setScrollbarIdle] = useState(false)
  const scrollbarIdleTimerRef = useRef<number | null>(null)
  const scrollbarHoverRef = useRef(false)
  // 进度条 UI 直接操作 DOM（fill / 滑块 / 百分比文本），避免每帧 React 重渲染整页列表
  const progressFillRef = useRef<HTMLDivElement>(null)
  const progressSliderRef = useRef<HTMLInputElement>(null)
  const progressTextRef = useRef<HTMLSpanElement>(null)
  // 拼接模式状态：用户正在拖拽底部滑块时不回写滑块值，避免与拖拽打架
  const seekingRef = useRef(false)
  // ─── 拼接模式：窗口化渲染 + 固定高度槽位（根除加载漂移 & 切模式卡顿）───
  const STITCH_ASPECT = 0.7 // 宽:高（漫画页通用比例），用于由容器宽度推算固定页高
  const [slotH, setSlotH] = useState(0)          // 每页固定高度（px），占位/加载/失败完全一致
  const slotHRef = useRef(0)
  const [view, setView] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const prevSlotHRef = useRef(0)

  // ─── 翻页逻辑 ───
  const step = settings.mode === 'double' ? 2 : 1

  // 翻到绝对页：非滚动模式只改页码；滚动模式额外把 scrollTop 滚动到该页（程序化，不回写 pageIndex）
  const goToPage = useCallback((target: number, dir: 1 | -1 = 1) => {
    turnedRef.current = true
    const t = Math.max(0, Math.min(pageCount - 1, target))
    setDirection(dir)
    setPageIndex(t)
    if (settings.mode === 'stitch') {
      // 页高固定，直接按页码定位（立即定位，无缓动）
      const sh = slotHRef.current || 1
      scrollerRef.current?.scrollToImmediate(t * sh)
    }
  }, [pageCount, settings.mode])

  const goNext = useCallback(() => {
    goToPage(Math.min(pageCount - 1, pageRef.current + step), 1)
  }, [pageCount, step, goToPage])

  const goPrev = useCallback(() => {
    goToPage(Math.max(0, pageRef.current - step), -1)
  }, [pageCount, step, goToPage])

  // ═══ 页码跳转弹窗 ═══
  const openJumpDialog = useCallback(() => {
    setJumpValue(String(Math.min(pageCount, pageIndex + 1)))
    setSettingsOpen(false)
    setJumpOpen(true)
  }, [pageIndex, pageCount, setSettingsOpen])

  const closeJumpDialog = useCallback(() => setJumpOpen(false), [])

  const handleJump = useCallback(() => {
    const n = parseInt(jumpValue, 10)
    if (!Number.isFinite(n)) { setJumpOpen(false); return }
    const clamped = Math.max(1, Math.min(pageCount, n))
    goToPage(clamped - 1, clamped >= pageIndex + 1 ? 1 : -1)
    setJumpOpen(false)
  }, [jumpValue, pageCount, pageIndex, goToPage])

  // ─── 缩放 toast 辅助 ───
  const bumpZoomToast = useCallback(() => {
    const token = ++zoomTokenRef.current
    setZoomToast({ token })
    if (zoomToastTimerRef.current !== null) {
      window.clearTimeout(zoomToastTimerRef.current)
    }
    zoomToastTimerRef.current = window.setTimeout(() => {
      setZoomToast((prev) => (prev && prev.token === token ? null : prev))
      zoomToastTimerRef.current = null
    }, 1200)
  }, [])

  const bumpZoomToastRef = useRef(bumpZoomToast)
  bumpZoomToastRef.current = bumpZoomToast

  useEffect(() => () => {
    if (zoomToastTimerRef.current !== null) {
      window.clearTimeout(zoomToastTimerRef.current)
      zoomToastTimerRef.current = null
    }
  }, [])

  // ─── 点击区域处理 ───
  const handleStageClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const zone = getClickZone(x, y)

    switch (zone) {
      case 'center':
        setBarsVisible(v => !v)
        break
      case 'left':
        if (settings.mode !== 'stitch') {
          if (isJapanese) { goNext() } else { goPrev() }
        }
        break
      case 'right':
        if (settings.mode !== 'stitch') {
          if (isJapanese) { goPrev() } else { goNext() }
        }
        break
    }
  }, [settings.mode, isJapanese, goNext, goPrev])

  // ─── 键盘 ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault(); adjustZoom(0.1); bumpZoomToastRef.current()
          return
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault(); adjustZoom(-0.1); bumpZoomToastRef.current()
          return
        }
        if (e.key === '0') {
          e.preventDefault(); resetZoom(); bumpZoomToastRef.current()
          return
        }
        return
      }

      if (e.key === 'Escape') {
        if (jumpOpenRef.current) { closeJumpDialog(); return }
        if (miniLibOpen) { setMiniLibOpen(false); return }
        if (gridLibOpen) { setGridLibOpen(false); return }
        if (settingsOpen) { setSettingsOpen(false); return }
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setDebugPanel(v => !v)
        return
      }

      const leftKey = isJapanese ? 'ArrowRight' : 'ArrowLeft'
      const rightKey = isJapanese ? 'ArrowLeft' : 'ArrowRight'

      if (e.key === leftKey || e.key === 'PageUp') {
        e.preventDefault(); goPrev()
      } else if (e.key === rightKey || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); goNext()
      } else if (e.key === 'Home') {
        goToPage(0, -1)
      } else if (e.key === 'End') {
        goToPage(pageCount - 1, 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev, onClose, pageCount, isJapanese, adjustZoom, resetZoom, miniLibOpen, gridLibOpen, settingsOpen])

  // ─── 自动连播：进入漫画默认关闭；速度值持久化，开关状态不持久化 ───
  useEffect(() => {
    setAutoPlayEnabled(false)
  }, [currentComicId])

  useEffect(() => {
    if (autoPlayTimerRef.current) {
      window.clearInterval(autoPlayTimerRef.current)
      autoPlayTimerRef.current = null
    }
    lastAutoPlayTickRef.current = 0
    if (!autoPlayEnabled) return

    if (settings.mode === 'stitch') {
      const speed = autoPlaySettings.scrollSpeedPxPerSecond
      autoPlayTimerRef.current = window.setInterval(() => {
        const s = scrollerRef.current
        if (!s) return
        const now = performance.now()
        const dt = Math.min(100, lastAutoPlayTickRef.current ? now - lastAutoPlayTickRef.current : 16)
        lastAutoPlayTickRef.current = now
        const max = s.getMaxScroll()
        if (max <= 0) return
        s.scrollBy(speed * (dt / 1000))
        if (s.getPos() >= max - 0.5) {
          setAutoPlayEnabled(false)
        }
      }, 16)
    } else {
      const interval = Math.max(500, autoPlaySettings.pageFlipIntervalMs)
      autoPlayTimerRef.current = window.setInterval(() => {
        if (pageRef.current >= pageCountRef.current - 1) {
          setAutoPlayEnabled(false)
          return
        }
        goNext()
      }, interval)
    }

    return () => {
      if (autoPlayTimerRef.current) {
        window.clearInterval(autoPlayTimerRef.current)
        autoPlayTimerRef.current = null
      }
      lastAutoPlayTickRef.current = 0
    }
  }, [autoPlayEnabled, settings.mode, autoPlaySettings.pageFlipIntervalMs, autoPlaySettings.scrollSpeedPxPerSecond, goNext])

  // ═══ 缩放时 stitch 滚动锚点保持 ═══
  // 由 slotH 变化时的 useLayoutEffect 按 lastRatioRef 比例重新定位，无需此处处理

  // ─── 统一滚轮处理 ───
  const wheelAccumRef = useRef(0)
  const wheelLastTsRef = useRef(0)
  const zoomAccumRef = useRef(0)

  const WHEEL_PER_PAGE = 90
  const WHEEL_MIN_GAP_MS = 60
  const WHEEL_MAX_STEP = 3
  // 每累积 ZOOM_STEP_PX 的 deltaY 精确缩放 1%（离散步长，保证来回一致、始终落在整数百分比）
  const ZOOM_STEP_PX = 100

  useEffect(() => {
    // ctrl/cmd + 滚轮：离散 ±1% 步长缩放
    const applyZoom = (delta: number) => {
      if (delta === 0) return
      adjustZoom(delta)
      bumpZoomToastRef.current()
    }

    const tryConsumePage = (force: boolean) => {
      const now = Date.now()
      if (!force && now - wheelLastTsRef.current < WHEEL_MIN_GAP_MS) return
      const acc = wheelAccumRef.current
      if (Math.abs(acc) < WHEEL_PER_PAGE) return
      const dir = acc >= 0 ? 1 : -1
      const steps = Math.min(
        WHEEL_MAX_STEP,
        Math.floor(Math.abs(acc) / WHEEL_PER_PAGE)
      )
      if (steps <= 0) return
      wheelAccumRef.current = acc - dir * steps * WHEEL_PER_PAGE
      wheelLastTsRef.current = now

      const goingNext = dir > 0
      const actuallyNext = isJapanese ? !goingNext : goingNext
      for (let i = 0; i < steps; i++) {
        if (actuallyNext) {
          goNext()
        } else {
          goPrev()
        }
      }
    }

    let rafPage: number | null = null
    const schedulePage = () => {
      if (rafPage !== null) return
      rafPage = window.requestAnimationFrame(() => {
        rafPage = null
        tryConsumePage(false)
        if (Math.abs(wheelAccumRef.current) >= WHEEL_PER_PAGE) schedulePage()
      })
    }

    const onWheel = (e: WheelEvent) => {
      // ctrl/cmd + 滚轮：缩放（挂在 reader 容器，设置面板打开时也能用）
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        if ('stopImmediatePropagation' in e) (e as any).stopImmediatePropagation()
        // 离散累加：向下滚(deltaY>0)缩小，向上滚(deltaY<0)放大
        zoomAccumRef.current += e.deltaY
        const steps = Math.trunc(zoomAccumRef.current / ZOOM_STEP_PX)
        if (steps !== 0) {
          zoomAccumRef.current -= steps * ZOOM_STEP_PX
          applyZoom(-steps * 0.01)
        }
        return
      }

      // 普通滚轮：落在设置/网格/迷你书库等浮层内时，交给原生滚动，不翻页
      const target = e.target as HTMLElement | null
      if (
        target &&
        target.closest(
          '.settings-panel, .settings-overlay, .mini-library, .grid-library, .grid-library-overlay'
        )
      ) {
        return
      }

      if (settings.mode === 'stitch') {
        // 拼接模式：完全接管滚轮，交给 JS 惯性控制器（transform 驱动，禁用原生滚动）
        const s = scrollerRef.current
        if (!s) return
        e.preventDefault()
        e.stopPropagation()
        s.wheel(e.deltaY)
        return
      }

      if (Math.abs(e.deltaY) < 5 && Math.abs(e.deltaX) < 5) return
      e.preventDefault()
      e.stopPropagation()

      const v = Math.abs(e.deltaY) >= 5 ? e.deltaY : e.deltaX
      if (Math.sign(v) * Math.sign(wheelAccumRef.current) < 0) {
        wheelAccumRef.current = 0
      }
      wheelAccumRef.current += v

      const now = Date.now()
      if (
        Math.abs(wheelAccumRef.current) >= WHEEL_PER_PAGE &&
        now - wheelLastTsRef.current >= WHEEL_MIN_GAP_MS
      ) {
        tryConsumePage(true)
      } else {
        schedulePage()
      }
    }

    // 监听挂在 window 上（捕获阶段）。注意：设置面板/网格书库/迷你书库均通过
    // createPortal 渲染到 document.body，不在 .reader 容器内，挂在 .reader 上会漏掉
    // 这些浮层上的滚轮。挂在 window 捕获阶段可覆盖整个阅读视图内的所有滚轮事件。
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      if (rafPage !== null) window.cancelAnimationFrame(rafPage)
    }
  }, [settings.mode, isJapanese, goNext, goPrev, adjustZoom])

  // ─── 页码变更 & 卸载时保存进度 ───
  useEffect(() => {
    onPageChange?.(pageIndex)
  }, [pageIndex, onPageChange])

  useEffect(() => {
    return () => {
      onPageChangeRef.current?.(pageRef.current)
    }
  }, [])

  // ─── 拼接模式：translateY（pos）为唯一真相源，原生 scroll 已彻底禁用 ───

  // ═══ 单一 UI 同步函数：从滚动位置 pos 派生滚动条 thumb + 页码式进度条 ═══
  // 滚动条 thumb 跟随 pos（视觉滚动指示）；进度条 / 文本按"视口顶部页"计算（页码式）。
  // 不再读取原生 scrollTop —— pos 来自 JS 滚动控制器的 translateY。
  const syncScrollFromPos = useCallback((pos: number, maxScroll: number) => {
    const el = stitchRef.current
    const thumb = scrollbarThumbRef.current
    const bar = scrollbarRef.current
    if (!el) return
    const trackHeight = el.clientHeight
    const canScroll = maxScroll > 1
    const ratio = maxScroll > 0 ? pos / maxScroll : 0

    if (bar) bar.style.pointerEvents = canScroll ? 'auto' : 'none'
    if (thumb) {
      if (!canScroll) {
        thumb.style.height = '0px'
      } else {
        // 内容总高 = maxScroll + trackHeight（替代原生 scrollHeight）
        const thumbHeight = Math.max(30, Math.round(trackHeight * (trackHeight / (maxScroll + trackHeight))))
        const maxThumbTop = trackHeight - thumbHeight
        thumb.style.height = `${thumbHeight}px`
        thumb.style.transform = `translateY(${ratio * maxThumbTop}px)`
        scrollbarStateRef.current.trackHeight = trackHeight
        scrollbarStateRef.current.thumbHeight = thumbHeight
      }
    }

    // 进度条：按"视口顶部页"计算（页码式）。页高固定后偏移线性 → floor(pos / slotH)。
    const pc = pageCountRef.current
    const sh = slotHRef.current || 1
    const topPage = pc > 0 ? Math.max(0, Math.min(pc - 1, Math.floor(pos / sh))) : 0
    const pageProgress = pc > 1 ? topPage / (pc - 1) : 0
    const pct = Math.round(pageProgress * 100)
    if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`
    if (!seekingRef.current && progressSliderRef.current) {
      progressSliderRef.current.value = String(pageProgress)
    }
    if (progressTextRef.current) {
      progressTextRef.current.textContent = `${topPage + 1} / ${pc}`
    }

    // 页码 + 可视窗口随滚动位置更新（替代旧的 onScroll 派生）
    if (topPage !== pageRef.current) setPageIndex(topPage)
    const visible = Math.ceil(trackHeight / sh)
    const topIdx = Math.floor(pos / sh)
    const start = Math.max(0, topIdx - 3)
    const end = Math.min(pc - 1, topIdx + visible + 3)
    setView((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  // 从控制器当前状态同步 UI（供尺寸 / 图片变化等被动刷新调用）
  const syncScrollNow = useCallback(() => {
    const s = scrollerRef.current
    if (!s) return
    syncScrollFromPos(s.getPos(), s.getMaxScroll())
  }, [syncScrollFromPos])

  // 非拼接模式：进度按"当前页"显示（与滚动条互不干扰，仅本模式使用）
  const updatePageModeProgress = useCallback((pg: number) => {
    const pc = pageCountRef.current
    const clamped = Math.max(0, Math.min(pc - 1, pg))
    const ratio = pc > 1 ? clamped / (pc - 1) : 0
    const pct = Math.round(ratio * 100)
    if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`
    if (!seekingRef.current && progressSliderRef.current) progressSliderRef.current.value = String(ratio)
    if (progressTextRef.current) progressTextRef.current.textContent = `${clamped + 1} / ${pc}`
  }, [])

  // 进度条同步：拼接模式由滚动控制器每帧回调驱动；其余模式按页码
  useEffect(() => {
    if (settings.mode === 'stitch') {
      syncScrollNow()
    } else {
      updatePageModeProgress(pageIndex)
    }
  }, [pageIndex, pageCount, settings.mode, syncScrollNow, updatePageModeProgress])

  // 图片加载（tick 变化）后刷新滚动条 UI
  useLayoutEffect(() => {
    if (settingsModeRef.current !== 'stitch') return
    syncScrollNow()
  }, [tick, syncScrollNow])

  // 图片解码完成（onLoad）：固定槽位高度已在 CSS 锁定，加载不会改变布局，
  // 此处仅刷新滚动条/进度 UI（内容总高恒定，thumb 与进度自然一致）。
  const handleStitchImgLoad = useCallback(() => {
    syncScrollNow()
  }, [syncScrollNow])

  // 无滚动时自动隐藏胶囊滚动条
  const resetScrollbarIdle = useCallback(() => {
    setScrollbarIdle(false)
    if (scrollbarIdleTimerRef.current) window.clearTimeout(scrollbarIdleTimerRef.current)
    scrollbarIdleTimerRef.current = window.setTimeout(() => {
      if (!scrollbarHoverRef.current) setScrollbarIdle(true)
    }, 1200)
  }, [])

  // ─── 由容器宽度推算每页固定高度（占位/加载/失败完全一致）───
  const measureSlotH = useCallback(() => {
    const el = stitchRef.current
    if (!el) return 0
    // 容器已 overflow:hidden 且无滚动条，内容宽即 clientWidth
    const contentW = Math.max(1, el.clientWidth)
    const h = Math.max(120, Math.round((contentW * zoom) / STITCH_ASPECT))
    slotHRef.current = h
    setSlotH(h)
    return h
  }, [zoom])

  useEffect(() => {
    if (settings.mode !== 'stitch') return
    const el = stitchRef.current
    const s = scrollerRef.current
    if (!el) return
    // 尺寸变化：重算页高并更新控制器指标（位置自动夹紧），再同步 UI
    const onResize = () => {
      const h = measureSlotH()
      const vh = el.clientHeight
      if (s) s.setMetrics(Math.max(1, pageCountRef.current) * h, vh)
      syncScrollNow()
    }
    window.addEventListener('resize', onResize)
    const ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null
    if (ro) ro.observe(el)
    scrollbarIdleTimerRef.current = window.setTimeout(() => {
      if (!scrollbarHoverRef.current) setScrollbarIdle(true)
    }, 1200)
    return () => {
      window.removeEventListener('resize', onResize)
      if (ro) ro.disconnect()
      if (scrollbarIdleTimerRef.current) window.clearTimeout(scrollbarIdleTimerRef.current)
    }
    // 依赖不含 measureSlotH：缩放不应重挂 resize 监听。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, syncScrollNow])

  // ─── 创建 / 销毁拼接模式滚动控制器（仅 stitch 模式存在）───
  useLayoutEffect(() => {
    if (settings.mode !== 'stitch') {
      scrollerRef.current = null
      return
    }
    const inner = stitchInnerRef.current
    const container = stitchRef.current
    if (!inner || !container) return
    const scroller = createStitchScroller({
      inner,
      // 每帧把滚动位置同步到滚动条 / 进度条 / 页码，并标记滚动活跃（闲置自动隐藏）
      onFrame: (pos, mx) => { syncScrollFromPos(pos, mx); resetScrollbarIdle() }
    })
    scrollerRef.current = scroller
    // 初始度量：内容总高 = 页数 × 固定页高；具体位置由下方"进入/切换"effect 定位
    const h = measureSlotH()
    scroller.setMetrics(Math.max(1, pageCountRef.current) * h, container.clientHeight)
    return () => { scroller.destroy(); scrollerRef.current = null }
    // 注意：依赖里不要放 measureSlotH —— 它的身份随 zoom 变化，放进来会导致每次缩放
    // 都销毁重建 scroller（重置 translateY=0）。缩放只需通过 slotH 状态 → 锚定 effect 按比例重定位。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, syncScrollFromPos, resetScrollbarIdle])

  // ─── 进入 / 切换漫画：定位到「当前页」顶部 → 设置可视窗口 ───
  useEffect(() => {
    if (settings.mode !== 'stitch') return
    const container = stitchRef.current
    const s = scrollerRef.current
    if (!container || !s) return
    const h = measureSlotH()
    const pc = pageCountRef.current
    const vh = container.clientHeight
    requestAnimationFrame(() => {
      s.setMetrics(Math.max(1, pc) * h, vh)
      const initPos = Math.min(Math.max(0, pc * h - vh), pageRef.current * h)
      s.scrollToImmediate(initPos)
      const sh = h || 1
      const topIdx = Math.floor(s.getPos() / sh)
      const visible = Math.ceil(vh / sh)
      setView({ start: Math.max(0, topIdx - 3), end: Math.min(pc - 1, topIdx + visible + 3) })
    })
    // 依赖不含 measureSlotH：缩放不应重新触发"进入/切换"定位（否则跳回当前页顶）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, currentComicId, pageCount])

  // ─── 页高变化（缩放 / 窗口尺寸）：按当前阅读比例重新锚定并重算窗口 ───
  useLayoutEffect(() => {
    const el = stitchRef.current
    const s = scrollerRef.current
    if (!el || !s || slotH <= 0) return
    const pc = pageCountRef.current
    if (prevSlotHRef.current > 0 && prevSlotHRef.current !== slotH) {
      // 页高固定 → 内容总高 ≈ pc*slotH；用变更前的比例重新定位，保持视觉位置
      const vh = el.clientHeight
      const oldMax = Math.max(0, pc * prevSlotHRef.current - vh)
      const curPos = s.getPos()
      const ratio = oldMax > 0 ? curPos / oldMax : 0
      const newMax = Math.max(0, pc * slotH - vh)
      s.setMetrics(pc * slotH, vh)
      s.setTranslateY(-Math.max(0, Math.min(newMax, ratio * newMax)))
      const sh = slotH
      const topIdx = Math.floor(s.getPos() / sh)
      const visible = Math.ceil(vh / sh)
      setView({ start: Math.max(0, topIdx - 3), end: Math.min(pc - 1, topIdx + visible + 3) })
    }
    prevSlotHRef.current = slotH
  }, [slotH, pageCount])

  // ─── 缩放变化：重算页高（会在上面的 layoutEffect 中按比例锚定）───
  useEffect(() => {
    if (settings.mode !== 'stitch') return
    measureSlotH()
  }, [settings.mode, zoom, measureSlotH])

  // 说明：窗口化采用「固定高度内层 + 绝对定位页槽」方案（见 JSX）。
  // scrollHeight 恒等于 pageCount*slotH，与可视窗口无关，因此切换窗口不会改变
  // 布局、也不改变 scrollTop，无需任何 scrollTop 补偿 —— 彻底消除「多滚一点就自动滚到底」的反馈回路。

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = scrollbarStateRef.current
      if (!state.dragging) return
      const s = scrollerRef.current
      if (!s) return
      const deltaY = e.clientY - state.dragStartY
      const trackHeight = state.trackHeight || (stitchRef.current?.clientHeight ?? 0)
      const thumbHeight = state.thumbHeight || 30
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
      const newTop = Math.max(0, Math.min(maxThumbTop, state.dragStartTop + deltaY))
      const ratio = maxThumbTop > 0 ? newTop / maxThumbTop : 0
      s.dragThumbToRatio(ratio)
    }
    const onUp = () => { scrollbarStateRef.current.dragging = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const handleScrollbarThumbDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const thumb = scrollbarThumbRef.current
    const match = thumb?.style.transform.match(/translateY\(([^p]+)px\)/)
    scrollbarStateRef.current = {
      ...scrollbarStateRef.current,
      dragging: true,
      dragStartY: e.clientY,
      dragStartTop: match ? parseFloat(match[1]) : 0
    }
  }, [])

  const handleScrollbarTrackClick = useCallback((e: React.MouseEvent) => {
    const el = stitchRef.current
    const s = scrollerRef.current
    const thumb = scrollbarThumbRef.current
    if (!el || !thumb || !s) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const clickY = e.clientY - rect.top
    const trackHeight = rect.height
    const thumbHeight = scrollbarStateRef.current.thumbHeight || parseFloat(thumb.style.height) || 30
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
    const ratio = maxThumbTop > 0
      ? Math.max(0, Math.min(1, (clickY - thumbHeight / 2) / maxThumbTop))
      : 0
    // 缓动定位到点击位置（复用 JS 控制器，不触发原生平滑滚动）
    s.scrollToPosition(ratio * s.getMaxScroll())
  }, [])

  // 拖拽进度条（滑块）：拼接模式 = 即时定位到对应页（页码式）；其它模式 = 跳到对应页
  const handleSeek = useCallback((ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio))
    if (settings.mode === 'stitch') {
      const s = scrollerRef.current
      if (s) {
        const pc = pageCountRef.current
        const targetPage = Math.min(pc - 1, Math.max(0, Math.round(r * (pc - 1))))
        const sh = slotHRef.current || 1
        s.scrollToImmediate(targetPage * sh)
      }
    } else {
      const target = Math.round(r * Math.max(1, pageCount - 1))
      setDirection(target >= pageRef.current ? 1 : -1)
      setPageIndex(Math.max(0, Math.min(pageCount - 1, target)))
    }
  }, [settings.mode, pageCount])

  // ─── 快速换书 ───
  const handleSwitchComic = useCallback((id: string) => {
    if (id === currentComicId) {
      setMiniLibOpen(false)
      setGridLibOpen(false)
      return
    }
    setMiniLibOpen(false)
    setGridLibOpen(false)
    onOpenComic(id)
  }, [currentComicId, onOpenComic])

  // ─── 计算动画方向 class ───
  const animDir = isJapanese
    ? (direction > 0 ? 'prev' : 'next')
    : (direction > 0 ? 'next' : 'prev')
  // 仅「翻页」时播放动效；进入漫画/换书（turnedRef=false）不播放，避免入场微幅抽动
  const animClass = turnedRef.current ? `anim-${settings.animation} anim-${animDir}` : ''

  // ─── 双页模式：计算当前展开页 ───
  const spreadStart = settings.mode === 'double' ? Math.floor(pageIndex / 2) * 2 : pageIndex
  const leftData = pagesDataRef.current[spreadStart] ?? null
  const rightData = pagesDataRef.current[spreadStart + 1] ?? null
  // 右页是否存在（最后一页为奇数页时右页不存在，不应渲染占位）
  const hasRight = settings.mode === 'double' && spreadStart + 1 < pageCount

  // ─── 渲染 ───
  return (
    <div className="reader" ref={readerRef}>
      <div className={`reader-topbar ${barsVisible ? 'visible' : ''}`}>
        <button className="reader-back-btn" onClick={onClose} title="返回 (Esc)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>返回</span>
        </button>
        <div className="reader-title" title={title}>{title}</div>
        <div className="reader-win-controls">
          <button className="reader-win-btn reader-win-btn-min" onClick={handleMinimize} title="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button className="reader-win-btn reader-win-btn-max" onClick={handleMaximize} title={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3.5 2H9V7.5H8V3.5H3.5V2Z" fill="currentColor" />
                <path d="M2 4.5H7.5V10H2V4.5Z" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
          <button className="reader-win-btn reader-win-btn-close" onClick={handleCloseWindow} title="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="reader-stage"
        onClick={handleStageClick}
        style={{ cursor: settings.mode === 'stitch' ? 'default' : 'pointer' }}
      >
        {pageCount === 0 ? (
          <div className="reader-empty">此漫画暂无页面</div>
        ) : settings.mode === 'stitch' ? (
          <div className="reader-stitch-wrapper">
            <div
              ref={stitchRef}
              className="reader-stitch-container"
              onClick={(e) => {
                const rect = stageRef.current?.getBoundingClientRect()
                if (!rect) return
                const x = (e.clientX - rect.left) / rect.width
                const y = (e.clientY - rect.top) / rect.height
                const zone = getClickZone(x, y)
                if (zone === 'center') {
                  setBarsVisible(v => !v)
                  e.stopPropagation()
                }
              }}
            >
              <div
                ref={stitchInnerRef}
                className="reader-stitch-inner"
                style={{ height: Math.max(1, pageCount) * slotH }}
              >
                {slotH > 0 && Array.from({ length: Math.max(0, view.end - view.start + 1) }, (_, k) => {
                  const i = view.start + k
                  return (
                    <div
                      key={i}
                      className="reader-stitch-slot"
                      style={{ top: i * slotH, height: slotH }}
                    >
                      <PageSlot
                        index={i}
                        dataUrl={pagesDataRef.current[i] ?? null}
                        name={`page-${i + 1}`}
                        zoom={zoom}
                        isStitch
                        slotHeight={slotH}
                        showImage
                        failed={failedRef.current.has(i)}
                        onRetry={retryPage}
                        onImgLoad={handleStitchImgLoad}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
            <div
              ref={scrollbarRef}
              className={`reader-custom-scrollbar ${settings.hideScrollbar || scrollbarIdle ? 'hidden' : ''}`}
              onMouseEnter={() => { scrollbarHoverRef.current = true }}
              onMouseLeave={() => {
                scrollbarHoverRef.current = false
                if (!scrollbarStateRef.current.dragging) resetScrollbarIdle()
              }}
            >
              <div
                className="reader-custom-scrollbar-track"
                onClick={handleScrollbarTrackClick}
              >
                <div
                  ref={scrollbarThumbRef}
                  className="reader-custom-scrollbar-thumb"
                  onMouseDown={handleScrollbarThumbDown}
                />
              </div>
            </div>
          </div>
        ) : settings.mode === 'double' ? (
          <div
            className={`reader-spread ${animClass}`}
          >
            {isJapanese ? (
              <>
                {hasRight && <PageSlot index={spreadStart + 1} dataUrl={rightData} name={`page-${spreadStart + 2}`} zoom={zoom} isStitch={false} fill={settings.pageFill} failed={failedRef.current.has(spreadStart + 1)} onRetry={retryPage} />}
                <PageSlot index={spreadStart} dataUrl={leftData} name={`page-${spreadStart + 1}`} zoom={zoom} isStitch={false} fill={settings.pageFill} failed={failedRef.current.has(spreadStart)} onRetry={retryPage} />
              </>
            ) : (
              <>
                <PageSlot index={spreadStart} dataUrl={leftData} name={`page-${spreadStart + 1}`} zoom={zoom} isStitch={false} fill={settings.pageFill} failed={failedRef.current.has(spreadStart)} onRetry={retryPage} />
                {hasRight && <PageSlot index={spreadStart + 1} dataUrl={rightData} name={`page-${spreadStart + 2}`} zoom={zoom} isStitch={false} fill={settings.pageFill} failed={failedRef.current.has(spreadStart + 1)} onRetry={retryPage} />}
              </>
            )}
          </div>
        ) : (
          <div
            className={`reader-page-single ${animClass}`}
          >
            <PageSlot index={pageIndex} dataUrl={pagesDataRef.current[pageIndex] ?? null} name={`page-${pageIndex + 1}`} zoom={zoom} isStitch={false} fill={settings.pageFill} failed={failedRef.current.has(pageIndex)} onRetry={retryPage} />
          </div>
        )}

        {zoomToast && (
          <div className="reader-zoom-toast" key={zoomToast.token}>
            <div className="reader-zoom-toast-inner">
              <span className="reader-zoom-toast-label">
                {settings.mode === 'stitch' ? '滚动缩放' : '页面缩放'}
              </span>
              <span className="reader-zoom-toast-value">
                {Math.round(zoom * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {!barsVisible && settings.showPageNumber && pageCount > 0 && (
        <div className="reader-immersive-pagenum">
          {pageIndex + 1}/{pageCount}
        </div>
      )}

      {debugPanel && (
        <div className="reader-debug-panel">
          <div className="reader-debug-title">诊断面板 (Ctrl+D 关闭)</div>
          <div>pageIndex: {pageIndex} / {pageCount}</div>
          <div>mode: {settings.mode}</div>
          <div>tick: {tick}</div>
          <div>pagesData.length: {pagesDataRef.current.length}</div>
          <div>current dataUrl len: {pagesDataRef.current[pageIndex]?.length ?? 'null'}</div>
          <div>loaded: {pagesDataRef.current.filter(Boolean).length}/{pageCount}</div>
          <div>failedTick: {failedTick}</div>
          <div>failed: {failedRef.current.has(pageIndex) ? 'yes' : 'no'}</div>
          <div>inFlight: {Array.from(inFlightRef.current).join(', ') || 'none'}</div>
          <div>last ok: {lastResult ? `idx=${lastResult.index} len=${lastResult.len} ${new Date(lastResult.time).toLocaleTimeString()}` : 'none'}</div>
          <div style={{ color: '#ff7b7b' }}>last err: {lastError ? `idx=${lastError.index} ${lastError.msg}` : 'none'}</div>
          <button onClick={() => retryPage(pageIndex)}>强制重试当前页</button>
        </div>
      )}

      <div className={`reader-bottombar ${barsVisible ? 'visible' : ''}`}>
        <button
          className="reader-bottom-btn"
          onClick={(e) => { e.stopPropagation(); setMiniLibOpen(v => !v); setSettingsOpen(false) }}
          title="快速换书"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>

        <div className="reader-progress" onClick={(e) => e.stopPropagation()}>
          <div className="reader-progress-track">
            <div className="reader-progress-fill" ref={progressFillRef} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              defaultValue={0}
              onChange={(e) => handleSeek(Number(e.target.value))}
              onPointerDown={() => { seekingRef.current = true }}
              onPointerUp={() => {
                seekingRef.current = false
                syncScrollNow()
              }}
              ref={progressSliderRef}
              className="reader-slider"
            />
          </div>
          <span
            className="reader-progress-text"
            ref={progressTextRef}
            title="点击跳转到指定页码"
            onClick={(e) => { e.stopPropagation(); jumpOpen ? closeJumpDialog() : openJumpDialog() }}
          />
          {jumpOpen && (
            <div
              className="jump-popover"
              ref={jumpPopoverRef}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="jump-title">跳转页码</div>
              <div className="jump-row">
                <input
                  className="jump-input"
                  type="number"
                  min={1}
                  max={pageCount}
                  value={jumpValue}
                  autoFocus
                  onChange={(e) => setJumpValue(e.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleJump() }
                    else if (e.key === 'Escape') { e.preventDefault(); closeJumpDialog() }
                  }}
                />
                <span className="jump-total">/ {pageCount}</span>
              </div>
              <div className="jump-actions">
                <button className="jump-btn" onClick={closeJumpDialog}>取消</button>
                <button className="jump-btn primary" onClick={handleJump}>跳转</button>
              </div>
            </div>
          )}
        </div>

        <button
          className="reader-bottom-btn"
          onClick={(e) => { e.stopPropagation(); setSettingsOpen(v => !v); setMiniLibOpen(false); setJumpOpen(false) }}
          title="阅读设置"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" stroke="currentColor" strokeWidth="1.8" />
            <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {miniLibOpen && createPortal(
        <MiniLibrary
          comics={comics}
          currentComicId={currentComicId}
          onSelect={handleSwitchComic}
          onMore={() => { setMiniLibOpen(false); setGridLibOpen(true) }}
          onClose={() => setMiniLibOpen(false)}
          onOverlayClick={() => { setMiniLibOpen(false); setBarsVisible(false) }}
        />,
        document.body
      )}

      {gridLibOpen && createPortal(
        <GridLibrary
          comics={comics}
          currentComicId={currentComicId}
          onSelect={handleSwitchComic}
          onClose={() => setGridLibOpen(false)}
          onOverlayClick={() => { setGridLibOpen(false); setBarsVisible(false) }}
        />,
        document.body
      )}

      {settingsOpen && createPortal(
        <SettingsPanel
          settings={settings}
          onUpdate={update}
          onAdjustZoom={adjustZoom}
          onResetZoom={resetZoom}
          currentZoom={zoom}
          onClose={() => setSettingsOpen(false)}
          onOverlayClick={() => { setSettingsOpen(false); setBarsVisible(false) }}
          autoPlayEnabled={autoPlayEnabled}
          onToggleAutoPlay={() => setAutoPlayEnabled(v => !v)}
          autoPlayExpanded={autoPlayExpanded}
          onToggleAutoPlayExpand={() => setAutoPlayExpanded(v => !v)}
          autoPlaySettings={autoPlaySettings}
          onSetPageFlipIntervalMs={setPageFlipIntervalMs}
          onSetScrollSpeedPxPerSecond={setScrollSpeedPxPerSecond}
        />,
        document.body
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// 迷你书库 —— 单行 3 封面，滚轮切换
// ═════════════════════════════════════════
function MiniLibrary({
  comics, currentComicId, onSelect, onMore, onClose, onOverlayClick
}: {
  comics: Comic[]
  currentComicId: string
  onSelect: (id: string) => void
  onMore: () => void
  onClose: () => void
  onOverlayClick?: () => void
}) {
  const list = useMemo(() => comics.filter(c => !c.hidden), [comics])

  return (
    <>
      <div className="mini-library-overlay" onClick={onOverlayClick ?? onClose} />
      <div className="mini-library">
        <CustomScrollbar direction="horizontal" contentClassName="mini-library-covers">
          {list.map(c => (
            <div
              key={c.id}
              className={`mini-library-cover ${c.id === currentComicId ? 'active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <div className="mini-library-cover-img">
                <CoverResolver comic={c}>
                  {(src) => src ? (
                    <img src={src} alt="" draggable={false} />
                  ) : (
                    <div className="mini-library-cover-placeholder">{c.title.charAt(0)}</div>
                  )}
                </CoverResolver>
              </div>
              <div className="mini-library-cover-title" title={c.title}>{c.title}</div>
            </div>
          ))}
        </CustomScrollbar>
        <button className="mini-library-more-btn" onClick={onMore} title="查看更多">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          <span>更多</span>
        </button>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════
// 网格书库 —— 5×5 封面网格
// ═════════════════════════════════════════
function GridLibrary({
  comics, currentComicId, onSelect, onClose, onOverlayClick
}: {
  comics: Comic[]
  currentComicId: string
  onSelect: (id: string) => void
  onClose: () => void
  onOverlayClick?: () => void
}) {
  const list = useMemo(() => comics.filter(c => !c.hidden), [comics])

  return (
    <div className="grid-library-overlay" onClick={onOverlayClick ?? onClose}>
      <div className="grid-library" onClick={(e) => e.stopPropagation()}>
        <div className="grid-library-header">
          <span>选择漫画</span>
          <button className="grid-library-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <CustomScrollbar contentClassName="grid-library-grid">
          {list.map(c => (
            <div
              key={c.id}
              className={`grid-library-item ${c.id === currentComicId ? 'active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <div className="grid-library-cover">
                <CoverResolver comic={c}>
                  {(src) => src ? (
                    <img src={src} alt="" draggable={false} />
                  ) : (
                    <div className="grid-library-cover-placeholder">{c.title.charAt(0)}</div>
                  )}
                </CoverResolver>
              </div>
              <div className="grid-library-title" title={c.title}>{c.title}</div>
            </div>
          ))}
        </CustomScrollbar>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// 设置面板
// ═════════════════════════════════════════
function SettingsPanel({
  settings, onUpdate, onAdjustZoom, onResetZoom, currentZoom, onClose, onOverlayClick,
  autoPlayEnabled, onToggleAutoPlay, autoPlayExpanded, onToggleAutoPlayExpand,
  autoPlaySettings, onSetPageFlipIntervalMs, onSetScrollSpeedPxPerSecond
}: {
  settings: ReturnType<typeof useReaderSettings>['settings']
  onUpdate: ReaderUpdateFn
  onAdjustZoom: ReturnType<typeof useReaderSettings>['adjustZoom']
  onResetZoom: ReturnType<typeof useReaderSettings>['resetZoom']
  currentZoom: number
  onClose: () => void
  onOverlayClick?: () => void
  autoPlayEnabled: boolean
  onToggleAutoPlay: () => void
  autoPlayExpanded: boolean
  onToggleAutoPlayExpand: () => void
  autoPlaySettings: ReturnType<typeof useAutoPlaySettings>['settings']
  onSetPageFlipIntervalMs: (v: number) => void
  onSetScrollSpeedPxPerSecond: (v: number) => void
}) {
  const maxZoomLabel = settings.mode === 'stitch' ? '400%' : '100%'
  const isStitch = settings.mode === 'stitch'
  return (
    <>
      <div className="settings-overlay" onClick={onOverlayClick ?? onClose} />
      <div className="settings-panel">
        {/* ── 自动连播（独立模块，在阅读设置上方）── */}
        <div className={`autoplay-section ${autoPlayExpanded ? 'expanded' : ''}`}>
          <div
            className="autoplay-header"
            onClick={(e) => {
              // 点击开关本身不触发折叠/展开
              if ((e.target as HTMLElement).closest('.autoplay-switch')) return
              onToggleAutoPlayExpand()
            }}
          >
            <span className="autoplay-title">自动连播</span>
            <button
              className={`autoplay-switch ${autoPlayEnabled ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleAutoPlay() }}
              title={autoPlayEnabled ? '当前开启' : '当前关闭'}
            >
              <span className="autoplay-switch-thumb" />
            </button>
            <svg
              className="autoplay-chevron"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          {autoPlayExpanded && (
            <div className="autoplay-body">
              {isStitch ? (
                <div className="autoplay-row">
                  <span className="autoplay-label">滚动速度</span>
                  <div className="autoplay-control">
                    <input
                      type="range"
                      min={10}
                      max={1000}
                      step={10}
                      value={autoPlaySettings.scrollSpeedPxPerSecond}
                      onChange={(e) => onSetScrollSpeedPxPerSecond(Number(e.target.value))}
                    />
                    <span className="autoplay-value">{autoPlaySettings.scrollSpeedPxPerSecond} px/s</span>
                  </div>
                </div>
              ) : (
                <div className="autoplay-row">
                  <span className="autoplay-label">翻页间隔</span>
                  <div className="autoplay-control">
                    <input
                      type="range"
                      min={500}
                      max={10000}
                      step={250}
                      value={autoPlaySettings.pageFlipIntervalMs}
                      onChange={(e) => onSetPageFlipIntervalMs(Number(e.target.value))}
                    />
                    <span className="autoplay-value">{(autoPlaySettings.pageFlipIntervalMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="settings-row">
          <span className="settings-label">阅读模式</span>
          <div className="settings-btns">
            {(['single', 'double', 'stitch'] as const).map(m => (
              <button
                key={m}
                className={`settings-btn ${settings.mode === m ? 'active' : ''}`}
                onClick={() => onUpdate('mode', m)}
              >
                {m === 'single' ? '单页' : m === 'double' ? '双页' : '滚动'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">翻页动效</span>
          <div className="settings-btns">
            {(['flip', 'slide', 'none'] as const).map(a => (
              <button
                key={a}
                className={`settings-btn ${settings.animation === a ? 'active' : ''}`}
                onClick={() => onUpdate('animation', a)}
              >
                {a === 'flip' ? '仿真' : a === 'slide' ? '滑入' : '无'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">页面填充</span>
          <div className="settings-btns">
            {(['contain', 'cover'] as const).map(f => (
              <button
                key={f}
                className={`settings-btn ${settings.pageFill === f ? 'active' : ''}`}
                onClick={() => onUpdate('pageFill', f)}
                title={f === 'contain' ? '保持比例，可能有黑边' : '占满容器，可能裁剪'}
              >
                {f === 'contain' ? '适应' : '填充'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">页面顺序</span>
          <div className="settings-btns">
            <button
              className={`settings-btn ${settings.pageOrder === 'normal' ? 'active' : ''}`}
              onClick={() => onUpdate('pageOrder', 'normal')}
              title="普通模式（左翻）"
            >普通</button>
            <button
              className={`settings-btn ${settings.pageOrder === 'japanese' ? 'active' : ''}`}
              onClick={() => onUpdate('pageOrder', 'japanese')}
              title="日式模式（右翻）"
            >日式</button>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label" title={`当前模式上限 ${maxZoomLabel}`}>缩放</span>
          <div className="settings-btns">
            <button className="settings-btn" onClick={() => onAdjustZoom(-0.1)}>−</button>
            <span className="settings-value">{Math.round(currentZoom * 100)}%</span>
            <button className="settings-btn" onClick={() => onAdjustZoom(0.1)}>+</button>
            <button className="settings-btn" onClick={onResetZoom} title="重置缩放">重置</button>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">小页码</span>
          <div className="settings-btns">
            <button
              className={`settings-btn ${settings.showPageNumber ? 'active' : ''}`}
              onClick={() => onUpdate('showPageNumber', true)}
            >显示</button>
            <button
              className={`settings-btn ${!settings.showPageNumber ? 'active' : ''}`}
              onClick={() => onUpdate('showPageNumber', false)}
            >隐藏</button>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label" title="仅在滚动模式下生效">滚动条</span>
          <div className="settings-btns">
            <button
              className={`settings-btn ${!settings.hideScrollbar ? 'active' : ''}`}
              onClick={() => onUpdate('hideScrollbar', false)}
            >显示</button>
            <button
              className={`settings-btn ${settings.hideScrollbar ? 'active' : ''}`}
              onClick={() => onUpdate('hideScrollbar', true)}
            >隐藏</button>
          </div>
        </div>
      </div>
    </>
  )
}

export default ComicReader
