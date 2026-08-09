import { useRef, useEffect, useCallback, useState, type ReactNode, type CSSProperties } from 'react'
import './CustomScrollbar.css'

interface CustomScrollbarProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  contentStyle?: CSSProperties
  /** 滚动方向：vertical（默认）| horizontal */
  direction?: 'vertical' | 'horizontal'
  /** 是否完全隐藏滚动条（保留滚动能力） */
  hidden?: boolean
  /** 不滚动时 thumb 自动隐藏的延迟（毫秒） */
  autoHideDelay?: number
}

/**
 * 通用胶囊形自定义滚动条。
 *
 * 由于 Windows 11 / Electron 的 Fluent overlay 滚动条会覆盖 ::-webkit-scrollbar CSS，
 * 这里把内容区设为 overflow: scroll（保留原生滚动作为 fallback），然后用 CSS 彻底隐藏
 * 原生滚动条，并自己监听 wheel 事件驱动 scrollTop/scrollLeft，自绘胶囊 thumb。
 * 这样既保证只有一条胶囊滚动条，也不会因为原生滚动条占位导致内部网格排版被挤压，
 * 同时即使 JS 逻辑出现意外，用户仍能依靠原生滚动继续操作。
 */
export default function CustomScrollbar({
  children,
  className,
  contentClassName,
  contentStyle,
  direction = 'vertical',
  hidden,
  autoHideDelay = 1200
}: CustomScrollbarProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [thumbSize, setThumbSize] = useState(0)
  const [thumbPos, setThumbPos] = useState(0)
  const [hasScroll, setHasScroll] = useState(false)
  const [active, setActive] = useState(false)
  const [hoverTrack, setHoverTrack] = useState(false)
  const stateRef = useRef({
    dragging: false,
    dragStart: 0,
    dragStartScroll: 0,
    thumbSize: 0
  })
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelRafRef = useRef<number | null>(null)
  const wheelStateRef = useRef({ pos: 0, velocity: 0 })

  const isHorizontal = direction === 'horizontal'

  // 惯性滚动参数（与阅读器拼接模式方案 B 对齐）：滚轮冲量驱动 velocity，
  // 每帧 pos += velocity、velocity *= FRICTION，越界施加回正力。单格位移 ≈ GAIN*deltaY/(1-FRICTION)。
  const FRICTION = 0.92    // 每帧速度 ×0.92（衰减 8%），停得比 0.95 利落
  const SPRING = 0.1       // 边界回正力系数
  const EDGE_DAMP = 0.6    // 越界额外阻尼
  const STOP_VEL = 0.1     // 停机速度阈值
  const WHEEL_GAIN = 0.1   // 滚轮冲量增益（越大越跟手）
  const MAX_V = 240        // 速度上限，防极端甩动飞出

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      setActive(false)
    }, autoHideDelay)
  }, [autoHideDelay, clearHideTimer])

  // 立即停止惯性滚动（thumb 拖拽 / 轨道点击前调用，避免与动量动画争抢 scrollTop）
  const stopMomentum = useCallback(() => {
    if (wheelRafRef.current != null) {
      cancelAnimationFrame(wheelRafRef.current)
      wheelRafRef.current = null
    }
    wheelStateRef.current.velocity = 0
  }, [])

  const getScrollState = useCallback(() => {
    const el = contentRef.current
    if (!el) return null
    if (isHorizontal) {
      return {
        client: el.clientWidth,
        scroll: el.scrollWidth,
        pos: el.scrollLeft
      }
    }
    return {
      client: el.clientHeight,
      scroll: el.scrollHeight,
      pos: el.scrollTop
    }
  }, [isHorizontal])

  const setScrollPos = useCallback((pos: number) => {
    const el = contentRef.current
    if (!el) return
    if (isHorizontal) {
      el.scrollLeft = pos
    } else {
      el.scrollTop = pos
    }
  }, [isHorizontal])

  const updateThumb = useCallback(() => {
    const state = getScrollState()
    if (!state) return
    const { client, scroll, pos } = state
    const needsScroll = scroll > client
    setHasScroll(needsScroll)
    if (!needsScroll) {
      setThumbSize(0)
      setThumbPos(0)
      stateRef.current.thumbSize = 0
      return
    }
    const trackSize = client
    const thumbS = Math.max(30, (client / scroll) * trackSize)
    const maxScroll = scroll - client
    const ratio = maxScroll > 0 ? pos / maxScroll : 0
    const maxThumbPos = trackSize - thumbS
    const posValue = ratio * maxThumbPos
    stateRef.current.thumbSize = thumbS
    setThumbSize(thumbS)
    setThumbPos(posValue)
  }, [getScrollState])

  // 惯性滚动动画：velocity 积分到 pos，速度按摩擦衰减，越界施加回正力。
  // 以原生 scrollTop/scrollLeft 为真相源——只接管 wheel，触控板/触摸原生滚动仍可用（fallback 保留）。
  const animateWheel = useCallback(() => {
    const el = contentRef.current
    if (!el) { wheelRafRef.current = null; return }
    const state = getScrollState()
    if (!state) { wheelRafRef.current = null; return }
    const maxScroll = Math.max(0, state.scroll - state.client)
    const s = wheelStateRef.current

    // 惯性积分：位置随速度推进，速度按摩擦衰减
    s.pos += s.velocity
    s.velocity *= FRICTION

    // 弹性边界：超出顶部(pos<0)或底部(pos>maxScroll)时施加回正力并额外阻尼；
    // 原生会夹断越界值（视觉停在边界），此处动量被吸收、平滑停下。
    if (s.pos < 0) {
      s.velocity += (0 - s.pos) * SPRING
      s.velocity *= EDGE_DAMP
    } else if (s.pos > maxScroll) {
      s.velocity += (maxScroll - s.pos) * SPRING
      s.velocity *= EDGE_DAMP
    }

    const clamped = Math.max(0, Math.min(maxScroll, s.pos))
    setScrollPos(clamped)
    updateThumb()

    // 停机条件：速度极小且已回到合法区间内
    if (Math.abs(s.velocity) < STOP_VEL && s.pos >= 0 && s.pos <= maxScroll) {
      s.velocity = 0
      s.pos = clamped
      wheelRafRef.current = null
      scheduleHide()
      return
    }
    wheelRafRef.current = requestAnimationFrame(animateWheel)
  }, [getScrollState, setScrollPos, updateThumb, scheduleHide])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const onScroll = () => {
      updateThumb()
      setActive(true)
      scheduleHide()
    }

    const onWheel = (e: WheelEvent) => {
      if (!hasScroll) return
      const delta = isHorizontal
        ? (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)
        : (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : 0)
      if (delta === 0) return
      e.preventDefault()

      const state = getScrollState()
      if (!state) return
      const s = wheelStateRef.current

      // 重同步 pos 到真实滚动位置（防止 thumb 拖拽 / 轨道点击 / 原生滚动造成错位）
      s.pos = state.pos
      // 累加速度形成惯性：向下(delta>0)使 scrollTop 增大，故 velocity 取 +delta*GAIN
      s.velocity += delta * WHEEL_GAIN
      s.velocity = Math.max(-MAX_V, Math.min(MAX_V, s.velocity))

      setActive(true)
      clearHideTimer()

      if (wheelRafRef.current == null) {
        wheelRafRef.current = requestAnimationFrame(animateWheel)
      }
    }

    const onResize = () => updateThumb()
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', onResize)
    const ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null
    if (ro) ro.observe(el)
    const childObserver = 'MutationObserver' in window ? new MutationObserver(onResize) : null
    if (childObserver) childObserver.observe(el, { childList: true, subtree: true })
    updateThumb()

    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      if (ro) ro.disconnect()
      if (childObserver) childObserver.disconnect()
      clearHideTimer()
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current)
        wheelRafRef.current = null
      }
    }
  }, [updateThumb, scheduleHide, clearHideTimer, animateWheel, hasScroll, getScrollState, isHorizontal])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!stateRef.current.dragging || !contentRef.current || !thumbRef.current) return
      const clientPos = isHorizontal ? e.clientX : e.clientY
      const delta = clientPos - stateRef.current.dragStart
      const state = getScrollState()
      if (!state) return
      const trackSize = state.client
      const thumbS = stateRef.current.thumbSize
      const maxThumbPos = trackSize - thumbS
      const ratio = maxThumbPos > 0 ? delta / maxThumbPos : 0
      const maxScroll = state.scroll - state.client
      setScrollPos(stateRef.current.dragStartScroll + ratio * maxScroll)
    }
    const onUp = () => {
      stateRef.current.dragging = false
      scheduleHide()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [scheduleHide, getScrollState, setScrollPos, isHorizontal])

  const handleThumbDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = contentRef.current
    if (!el) return
    clearHideTimer()
    setActive(true)
    stopMomentum()
    const state = getScrollState()
    stateRef.current = {
      dragging: true,
      dragStart: isHorizontal ? e.clientX : e.clientY,
      dragStartScroll: state ? state.pos : 0,
      thumbSize: stateRef.current.thumbSize
    }
  }, [clearHideTimer, getScrollState, isHorizontal, stopMomentum])

  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      stopMomentum()
      const el = contentRef.current
      if (!el || !thumbRef.current) return
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
      const clickPos = isHorizontal
        ? e.clientX - rect.left
        : e.clientY - rect.top
      // 轨道点击翻页距离：从 0.8 视口改为 0.45，避免"点击一下跳一大段"。
      const pageSize = (getScrollState()?.client || 0) * 0.45
      const currentEnd = thumbPos + thumbSize
      const dir = clickPos > currentEnd ? 1 : -1
      const state = getScrollState()
      if (!state) return
      setScrollPos(Math.max(0, Math.min(state.scroll - state.client, state.pos + dir * pageSize)))
    },
    [thumbSize, thumbPos, getScrollState, setScrollPos, isHorizontal, stopMomentum]
  )

  const showThumb = hasScroll && !hidden && (active || hoverTrack)

  const thumbStyle: CSSProperties = isHorizontal
    ? { width: thumbSize, transform: `translateX(${thumbPos}px)` }
    : { height: thumbSize, transform: `translateY(${thumbPos}px)` }

  return (
    <div className={`custom-scrollbar custom-scrollbar--${direction} ${className || ''}`}>
      <div
        ref={contentRef}
        className={`custom-scrollbar-content custom-scrollbar-content--${direction} ${contentClassName || ''}`}
        style={contentStyle}
      >
        {children}
      </div>
      <div
        className={`custom-scrollbar-bar custom-scrollbar-bar--${direction} ${showThumb ? 'is-visible' : ''}`}
        onMouseEnter={() => { setHoverTrack(true); clearHideTimer() }}
        onMouseLeave={() => { setHoverTrack(false); scheduleHide() }}
      >
        <div className={`custom-scrollbar-track custom-scrollbar-track--${direction}`} onClick={handleTrackClick}>
          <div
            ref={thumbRef}
            className={`custom-scrollbar-thumb custom-scrollbar-thumb--${direction}`}
            style={thumbStyle}
            onMouseDown={handleThumbDown}
          />
        </div>
      </div>
    </div>
  )
}
