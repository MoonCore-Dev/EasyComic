import { useLayoutEffect, useRef, useState } from 'react'

export interface GridConfig {
  cols: number
  gap: number
  /** 单个封面的目标宽度（px） */
  cardW: number
  /** 整个模块（封面 + 下方文字）的统一缩放系数，下限由 MIN_SCALE 保证 */
  scale: number
  /** 右侧预留留白（px）：给背景剪影效果留空间，随窗口缩放 */
  reservedRight: number
}

// ─── 布局参数（1:1 复刻参考图：全屏 8 列 + 比例间距 + 右侧 6% 留白）────
const TARGET_COLS = 8 // 目标列数（复刻参考图：1280×720 下一排 8 个封面）
const GAP_RATIO = 0.25 // 间距 = 封面宽度 × 25%（参考图实测约 30%，保守取 25%）
const MIN_GAP = 20 // 间距最小值（美观下限，封顶不限制以保持比例）
const MIN_CARD = 90 // 封面下限(px)：低于此先减列保住下限
const MIN_SCALE = 0.78 // 整个模块缩放下限
const MIN_COLS = 2 // 窗口很窄时最少列数（避免溢出）
// 右侧留白：占内容区宽度的比例，随窗口缩放，限制在 [24, 80]
// 保留少量右侧空间给剪影背景，但不过度挤压网格列数
const RIGHT_RESERVE_RATIO = 0.06
const MIN_RIGHT_RESERVE = 24
const MAX_RIGHT_RESERVE = 80
// ───────────────────────────────────────────────────────────

/** 给定列数，迭代求解稳定的 gap 与 cardW（gap 依赖于 cardW） */
function solve(cols: number, W: number): { gap: number; cardW: number } {
  let cardW = W / cols
  let gap = Math.max(MIN_GAP, cardW * GAP_RATIO)
  for (let i = 0; i < 12; i++) {
    const g = Math.max(MIN_GAP, cardW * GAP_RATIO)
    const c = (W - (cols - 1) * g) / cols
    if (Math.abs(c - cardW) < 0.5) {
      return { gap: g, cardW: c }
    }
    cardW = c
  }
  return { gap, cardW }
}

/**
 * 测量网格实际内容容器宽度，按"目标列数 8 + 比例间距 + 右侧留白"计算布局。
 *
 * 关键修复：之前测量外层 .library 宽度，没有扣除 CustomScrollbar 胶囊条占用的空间，
 * 导致滚动条出现时实际可用宽度变小，最后一列被挤到下一行（"每排漫画数变少"）。
 * 现在直接测量 grid 元素本身的 clientWidth：它等于父容器内容区宽度，且已排除滚动条，
 * 因此滚动条出现/消失不会改变列数。
 *
 * 同时加入防抖（150ms），避免导入过程中尺寸频繁抖动造成视觉跳动。
 */
export function useResponsiveGrid() {
  const ref = useRef<HTMLDivElement>(null)
  const [cfg, setCfg] = useState<GridConfig>({ cols: 8, gap: 26, cardW: 104, scale: 1, reservedRight: 80 })
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const grid = ref.current
    if (!grid) return

    const compute = () => {
      // grid.clientWidth 等于父容器内容区宽度（已自动扣除 CustomScrollbar 胶囊条），
      // 且包含我们设定的 paddingRight，因此 fullW 就是计算布局所需的「总内容宽度」。
      const fullW = grid.clientWidth
      if (fullW <= 0) return

      // 右侧预留留白（给背景剪影），随窗口缩放，限制在 [MIN, MAX]
      const reservedRight = Math.min(
        MAX_RIGHT_RESERVE,
        Math.max(MIN_RIGHT_RESERVE, Math.round(fullW * RIGHT_RESERVE_RATIO))
      )
      // 实际用于排布的可视宽度（扣除右侧留白）
      const W = fullW - reservedRight

      // 目标列数固定 8（复刻参考图）；窗口太窄时减列保住封面下限
      let cols = TARGET_COLS
      let { gap, cardW } = solve(cols, W)
      while (cardW < MIN_CARD && cols > MIN_COLS) {
        cols -= 1
        const r = solve(cols, W)
        gap = r.gap
        cardW = r.cardW
      }

      // 整体缩放：列数到底仍不足时，封面与文字一起等比缩小
      const scale = Math.min(1, Math.max(MIN_SCALE, cardW / 140))

      setCfg((prev) =>
        prev.cols === cols && prev.gap === gap && prev.cardW === cardW && prev.scale === scale && prev.reservedRight === reservedRight
          ? prev
          : { cols, gap, cardW, scale, reservedRight }
      )
    }

    const schedule = () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (rafRef.current != null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          compute()
        })
      }, 150)
    }

    compute()
    const ro = new ResizeObserver(schedule)
    ro.observe(grid)
    window.addEventListener('resize', schedule)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])

  return { ref, ...cfg }
}
