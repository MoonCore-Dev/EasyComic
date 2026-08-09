import { useEffect, useState } from 'react'
import type { Comic } from '../types/comic'
import { useCoverUrl } from '../hooks/useCoverUrl'
import './BackdropLayer.css'

interface BackdropLayerProps {
  /** 当前悬停的漫画；为 null 表示无悬停，使用默认背景 */
  comic: Comic | null
  /** 是否启用虚化漫画封面背景；默认 true。设为 false 时仅显示默认主题背景 */
  enabled?: boolean
}

export default function BackdropLayer({ comic, enabled = true }: BackdropLayerProps) {
  const coverUrl = useCoverUrl(comic)
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!coverUrl) {
      setLoaded(false)
      setDisplayUrl(null)
      return
    }
    let active = true
    const img = new Image()
    img.onload = () => {
      if (!active) return
      setDisplayUrl(coverUrl)
      // 下一帧再触发淡入，避免加载过快时无过渡
      requestAnimationFrame(() => setLoaded(true))
    }
    img.onerror = () => {
      if (!active) return
      setLoaded(false)
      setDisplayUrl(null)
    }
    img.src = coverUrl
    return () => {
      active = false
    }
  }, [coverUrl])

  const hasImage = Boolean(displayUrl)

  return (
    <div className="backdrop-layer" aria-hidden="true">
      {/* 默认主题背景：始终显示，作为无悬停/封面损坏时的兜底 */}
      <div className="backdrop-default" />

      {/* 悬停封面背景：加载成功后淡入（仅在启用时显示） */}
      {enabled && hasImage && (
        <div
          className={`backdrop-image ${loaded ? 'is-visible' : ''}`}
          style={{ backgroundImage: `url(${displayUrl})` }}
        />
      )}

      {/* 暗色遮罩：保证前景文字可读 */}
      <div className="backdrop-dim" />
    </div>
  )
}
