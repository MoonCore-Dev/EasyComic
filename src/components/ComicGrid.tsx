import type { CSSProperties, ReactNode } from 'react'
import { useResponsiveGrid } from '../comic/useResponsiveGrid'

interface ComicGridProps {
  children: ReactNode
  className?: string
}

/**
 * 响应式漫画网格容器：根据内容区宽度自动决定列数 / 间距 / 整体缩放。
 * 把 --card-scale 写到自身 style 上，子元素（封面、标题、元信息）据此等比缩放，
 * 保证整个模块（封面 + 下方文字）有统一的最小值，不会被压得过小或割裂。
 */
export default function ComicGrid({ children, className }: ComicGridProps) {
  const { ref, gap, cardW, scale, reservedRight } = useResponsiveGrid()
  // 用 auto-fill + 固定卡片宽度，让最后一行不满时右侧自然留白；
  // 再额外预留 paddingRight 给背景剪影效果（参考图右侧留白更大）
  const style = {
    gridTemplateColumns: `repeat(auto-fill, ${cardW}px)`,
    gap: `${gap}px`,
    paddingRight: `${reservedRight}px`,
    '--card-scale': scale,
  } as CSSProperties

  return (
    <div
      ref={ref}
      className={`comic-grid${className ? ` ${className}` : ''}`}
      style={style}
    >
      {children}
    </div>
  )
}
