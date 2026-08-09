import { useState, useEffect, useRef, useMemo } from 'react'
import type { Comic } from '../types/comic'
import { useToast } from '../store/toast'
import { useHomeSettings } from '../comic/useHomeSettings'
import { CoverResolver } from './CoverResolver'
import ComicGrid from './ComicGrid'
import BackdropLayer from './BackdropLayer'
import CustomScrollbar from './CustomScrollbar'
import './Library.css'

interface SearchProps {
  comics: Comic[]
  onOpenComic: (comicId: string) => void
  onChangeCover?: (comicId: string) => void
  onRemoveComic?: (comicId: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  comicId: string
}

function Search({ comics, onOpenComic, onChangeCover, onRemoveComic }: SearchProps) {
  const { settings: homeSettings } = useHomeSettings()
  const [keyword, setKeyword] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [hoveredComic, setHoveredComic] = useState<Comic | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { showConfirm } = useToast()

  const results = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return []
    return comics.filter((c) => c.title.toLowerCase().includes(kw))
  }, [comics, keyword])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        if (document.activeElement === inputRef.current) {
          inputRef.current?.blur()
        }
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menu])

  const handleContextMenu = (e: React.MouseEvent, comicId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, comicId })
  }

  const handleRemove = async (comicId: string) => {
    const comic = comics.find(c => c.id === comicId)
    const ok = await showConfirm({
      title: '确认移除',
      message: `确认将「${comic?.title ?? '此漫画'}」从书库移除？\n(不会删除电脑上的原文件)`,
      confirmText: '移除',
      cancelText: '取消',
      dismissibleId: 'remove-comic'
    })
    if (ok) {
      onRemoveComic?.(comicId)
    }
    setMenu(null)
  }

  const handleClear = () => {
    setKeyword('')
    inputRef.current?.focus()
  }

  return (
    <div className="library">
      <BackdropLayer comic={hoveredComic} enabled={homeSettings.backdropBlurEnabled} />
      <div className="library-toolbar">
        <div className="library-toolbar-title">
          搜索
          {keyword.trim() && (
            <span className="library-count">{results.length} 个结果</span>
          )}
        </div>
        <div className="library-toolbar-actions">
          <div className="search-input-wrap">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="搜索漫画名称…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              autoFocus
            />
            {keyword.trim() && (
              <button className="search-clear-btn" onClick={handleClear} title="清除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <CustomScrollbar contentClassName="library-scroll">
        {!keyword.trim() ? (
          <div className="library-empty">
            <div className="library-empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
                <line x1="17" y1="17" x2="22" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="library-empty-text">输入关键字开始搜索</p>
            <p className="library-empty-hint">支持按漫画名称进行模糊搜索</p>
          </div>
        ) : results.length === 0 ? (
          <div className="library-empty">
            <div className="library-empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
                <line x1="17" y1="17" x2="22" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="library-empty-text">未找到匹配的漫画</p>
            <p className="library-empty-hint">没有包含「{keyword}」的漫画</p>
          </div>
        ) : (
          <ComicGrid>
            {results.map((comic) => (
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
                <div className="comic-title" title={comic.title}>
                  {highlightTitle(comic.title, keyword)}
                </div>
                {comic.pageCount > 0 && (
                  <div className="comic-meta">
                    {comic.pageCount} 页
                    {comic.progress >= 1 && <span className="comic-badge-done">已读完</span>}
                    {comic.progress > 0 && comic.progress < 1 && (
                      <span className="comic-badge-progress">
                        {Math.round(comic.progress * 100)}%
                      </span>
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
            onClick={() => {
              onChangeCover?.(menu.comicId)
              setMenu(null)
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            更换封面
          </button>
          {onRemoveComic && (
            <button
              className="comic-context-item comic-context-danger"
              onClick={() => handleRemove(menu.comicId)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              从书库移除(保留文件)
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function highlightTitle(title: string, keyword: string): React.ReactNode {
  const kw = keyword.trim()
  if (!kw) return title
  const lower = title.toLowerCase()
  const idx = lower.indexOf(kw.toLowerCase())
  if (idx < 0) return title
  const before = title.slice(0, idx)
  const match = title.slice(idx, idx + kw.length)
  const after = title.slice(idx + kw.length)
  return (
    <>
      {before}
      <span className="search-highlight">{match}</span>
      {after}
    </>
  )
}

export default Search
