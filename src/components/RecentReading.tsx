import { useMemo, useState, useEffect, useRef } from 'react'
import type { Comic } from '../types/comic'
import { useToast } from '../store/toast'
import { usePersisted } from '../comic/usePersisted'
import { useHomeSettings } from '../comic/useHomeSettings'
import { CoverResolver } from './CoverResolver'
import ComicGrid from './ComicGrid'
import BackdropLayer from './BackdropLayer'
import CustomScrollbar from './CustomScrollbar'
import './Library.css'

interface RecentReadingProps {
  comics: Comic[]
  onOpenComic: (comicId: string) => void
  onRequestImport?: () => void
  onClearFromRecent?: (comicId: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  comicId: string
}

function formatLastRead(timestamp: number): string {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function InfoTip({
  hideTime, onHideTimeChange
}: {
  hideTime: boolean
  onHideTimeChange: (v: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  return (
    <div className="recent-info-wrap" ref={ref}>
      <div
        className="recent-info-icon"
        title="显示选项"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
          <line x1="12" y1="10" x2="12" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="7.5" r="1" fill="currentColor" />
        </svg>
      </div>
      {open && (
        <div className="recent-info-tip">
          <div className="recent-info-section">此界面只显示已经阅读过的漫画</div>
          <label className="recent-info-check">
            <input
              type="checkbox"
              checked={hideTime}
              onChange={(e) => onHideTimeChange(e.target.checked)}
            />
            <span>隐藏最近阅读时间</span>
          </label>
        </div>
      )}
    </div>
  )
}

function RecentReading({ comics, onOpenComic, onRequestImport, onClearFromRecent }: RecentReadingProps) {
  const { settings: homeSettings } = useHomeSettings()
  // 隐藏时间的勾选项（持久化）
  const { value: hideTime, setValue: setHideTime } = usePersisted<boolean>('easycomic:recent-hide-time', false)
  const [hoveredComic, setHoveredComic] = useState<Comic | null>(null)

  const readComics = useMemo(() => {
    return comics
      .filter(c => c.lastReadAt > 0)
      .sort((a, b) => b.lastReadAt - a.lastReadAt)
  }, [comics])

  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { showConfirm } = useToast()

  const handleContextMenu = (e: React.MouseEvent, comicId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, comicId })
  }

  useEffect(() => {
    if (!menu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menu])

  const handleClear = async (comicId: string) => {
    const comic = comics.find(c => c.id === comicId)
    const ok = await showConfirm({
      title: '移除阅读记录',
      message: `确认将「${comic?.title ?? '此漫画'}」从最近阅读中移除？\n(再次阅读后会重新出现在列表中)`,
      confirmText: '移除',
      cancelText: '取消',
      dismissibleId: 'remove-recent'
    })
    if (ok) {
      onClearFromRecent?.(comicId)
    }
    setMenu(null)
  }

  const emptyBody = (
    <div className="library-empty">
      <div className="library-empty-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="library-empty-text">还没有阅读记录</p>
      <p className="library-empty-hint">打开一本漫画开始阅读吧</p>
      {onRequestImport && (
        <button className="library-empty-btn" onClick={onRequestImport}>
          前往书库
        </button>
      )}
    </div>
  )

  return (
    <div className="library">
      <BackdropLayer comic={hoveredComic} enabled={homeSettings.backdropBlurEnabled} />
      <div className="library-toolbar">
        <div className="library-toolbar-title">最近阅读 <span className="library-count">{readComics.length}</span></div>
        <div className="library-toolbar-actions">
          <InfoTip hideTime={!!hideTime} onHideTimeChange={setHideTime} />
        </div>
      </div>

      <CustomScrollbar contentClassName="library-scroll">
        {readComics.length === 0 ? emptyBody : (
          <ComicGrid>
            {readComics.map((comic) => (
              <div
                key={comic.id}
                className="comic-card"
                onClick={() => onOpenComic(comic.id)}
                onContextMenu={(e) => handleContextMenu(e, comic.id)}
                onMouseEnter={() => setHoveredComic(comic)}
                onMouseLeave={() => setHoveredComic(null)}
              >
                <CoverResolver comic={comic}>
                  {(src) => (
                    <div
                      className="comic-cover"
                      style={src ? { backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    >
                      {!src && (
                        <div className="comic-cover-placeholder">{comic.title.charAt(0) || '📖'}</div>
                      )}
                      {comic.progress > 0 && (
                        <div className="comic-progress-bar">
                          <div
                            className="comic-progress-fill"
                            style={{ width: `${comic.progress * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </CoverResolver>
                <div className="comic-title" title={comic.title}>{comic.title}</div>
                {comic.pageCount > 0 && (
                  <div className="comic-meta">
                    {comic.progress >= 1 ? (
                      <span className="comic-badge-done">已读完</span>
                    ) : comic.progress > 0 ? (
                      <span className="comic-badge-progress">
                        {Math.round(comic.progress * 100)}%
                      </span>
                    ) : null}
                    {!hideTime && comic.lastReadAt > 0 && (
                      <span>{formatLastRead(comic.lastReadAt)}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </ComicGrid>
        )}
      </CustomScrollbar>

      {menu && (
        <div
          ref={menuRef}
          className="comic-context-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="comic-context-item"
            onClick={() => handleClear(menu.comicId)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            从最近阅读中移除
          </button>
        </div>
      )}
    </div>
  )
}

export default RecentReading
