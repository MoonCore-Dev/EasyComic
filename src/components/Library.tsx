import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Comic } from '../types/comic'
import { useToast } from '../store/toast'
import { usePersisted } from '../comic/usePersisted'
import { useHomeSettings } from '../comic/useHomeSettings'
import { CoverResolver } from './CoverResolver'
import ComicGrid from './ComicGrid'
import BackdropLayer from './BackdropLayer'
import CustomScrollbar from './CustomScrollbar'
import './Library.css'

type SortType = 'name-asc' | 'name-desc' | 'recent' | 'added-desc' | 'added-asc'

const SORT_LABELS: Record<SortType, string> = {
  'name-asc': '名称 A→Z',
  'name-desc': '名称 Z→A',
  'recent': '最近阅读',
  'added-desc': '最新添加',
  'added-asc': '最早添加'
}

const SORT_ICONS: Record<SortType, JSX.Element> = {
  'name-asc': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 4h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  'name-desc': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 4h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  'recent': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  'added-desc': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  'added-asc': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 21V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 14l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 3h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const SORT_CYCLE: SortType[] = ['name-asc', 'name-desc', 'recent', 'added-desc', 'added-asc']

interface LibraryProps {
  comics: Comic[]
  onOpenComic: (comicId: string) => void
  onRequestImport?: () => void
  onChangeCover?: (comicId: string) => void
  onRemoveComic?: (comicId: string) => void
  onRefreshAll?: () => Promise<void> | void
  isRefreshing?: boolean
  isLoading?: boolean
}

interface ContextMenuState {
  x: number
  y: number
  comicId: string
}

function Library({ comics, onOpenComic, onRequestImport, onChangeCover, onRemoveComic, onRefreshAll, isRefreshing, isLoading }: LibraryProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [hoveredComic, setHoveredComic] = useState<Comic | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const sortBtnRef = useRef<HTMLButtonElement>(null)
  const sortDropdownRef = useRef<HTMLDivElement>(null)
  const [sortDropdownPos, setSortDropdownPos] = useState<{ top: number; right: number } | null>(null)
  const { showConfirm } = useToast()
  const { settings: homeSettings } = useHomeSettings()
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const { value: sortPersisted, setValue: setSortPersisted } = usePersisted<SortType>('easycomic:sort-type', 'added-desc')
  const sortType: SortType = SORT_CYCLE.includes(sortPersisted as SortType) ? sortPersisted as SortType : 'added-desc'
  const setSortType = (next: SortType | ((prev: SortType) => SortType)) => {
    if (typeof next === 'function') {
      setSortPersisted(prev => {
        const p = SORT_CYCLE.includes(prev as SortType) ? prev as SortType : 'added-desc'
        return (next as (p: SortType) => SortType)(p)
      })
    } else {
      setSortPersisted(next)
    }
  }

  const sortedComics = useMemo(() => {
    const arr = [...comics]
    switch (sortType) {
      case 'name-asc':
        return arr.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
      case 'name-desc':
        return arr.sort((a, b) => b.title.localeCompare(a.title, 'zh'))
      case 'recent':
        return arr.sort((a, b) => b.lastReadAt - a.lastReadAt)
      case 'added-desc':
        return arr.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      case 'added-asc':
        return arr.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))
      default:
        return arr
    }
  }, [comics, sortType])

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
      if (e.key === 'Escape') { setMenu(null); setSortMenuOpen(false) }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menu])

  const updateSortDropdownPos = useCallback(() => {
    const btn = sortBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setSortDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
  }, [])

  useEffect(() => {
    if (!sortMenuOpen) return
    updateSortDropdownPos()
    const handleResize = () => updateSortDropdownPos()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [sortMenuOpen, updateSortDropdownPos])

  useEffect(() => {
    if (!sortMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      const insideBtn = sortBtnRef.current?.contains(target) ?? false
      const insideDropdown = sortDropdownRef.current?.contains(target) ?? false
      if (!insideBtn && !insideDropdown) {
        setSortMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
    }
  }, [sortMenuOpen])

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

  const emptyBody = (
    <div className="library-empty">
      {isLoading ? (
        <>
          <div className="library-empty-spinner" />
          <p className="library-empty-text">正在加载书库…</p>
          <p className="library-empty-hint">首次启动需要从磁盘读取数据，请稍候</p>
        </>
      ) : (
        <>
          <div className="library-empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="library-empty-text">书库还是空的</p>
          <p className="library-empty-hint">点击左侧「导入漫画文件夹」添加漫画</p>
          {onRequestImport && (
            <button className="library-empty-btn" onClick={onRequestImport}>
              立即导入
            </button>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="library">
      <BackdropLayer comic={hoveredComic} enabled={homeSettings.backdropBlurEnabled} />
      <div className="library-toolbar">
        <div className="library-toolbar-title">书库 <span className="library-count">{comics.length}</span></div>
        <div className="library-toolbar-actions">
          <div className="library-sort-wrapper" ref={sortMenuRef}>
            <button
              ref={sortBtnRef}
              className="library-sort-btn"
              title="排序方式"
              onClick={() => setSortMenuOpen((v) => !v)}
            >
              {SORT_ICONS[sortType]}
              <span className="library-sort-label">{SORT_LABELS[sortType]}</span>
              <svg className={`library-sort-caret ${sortMenuOpen ? 'is-open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {sortMenuOpen && sortDropdownPos && createPortal(
              <div
                ref={sortDropdownRef}
                className="library-sort-dropdown library-sort-dropdown--portal"
                style={{ top: sortDropdownPos.top, right: sortDropdownPos.right }}
              >
                {SORT_CYCLE.map((t) => (
                  <button
                    key={t}
                    className={`library-sort-option ${t === sortType ? 'is-active' : ''}`}
                    onClick={() => { setSortType(t); setSortMenuOpen(false) }}
                  >
                    <span className="library-sort-option-icon">{SORT_ICONS[t]}</span>
                    <span>{SORT_LABELS[t]}</span>
                    {t === sortType && (
                      <svg className="library-sort-check" width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
          <button
            className={`library-refresh-btn ${isRefreshing ? 'is-rotating' : ''}`}
            title="刷新漫画(重新扫描文件夹)"
            onClick={() => onRefreshAll?.()}
            disabled={isRefreshing}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M21 12a9 9 0 1 1-3.2-6.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M21 4v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <CustomScrollbar contentClassName="library-scroll">
        {comics.length === 0 ? emptyBody : (
          <ComicGrid>
            {sortedComics.map((comic) => (
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
                    {comic.pageCount} 页
                    {comic.progress >= 1 && <span className="comic-badge-done">已读完</span>}
                    {comic.progress > 0 && comic.progress < 1 && (
                      <span className="comic-badge-progress">
                        {Math.round(comic.progress * 100)}%
                      </span>
                    )}
                    {homeSettings.showFileType && comic.fileType && (
                      <span className="comic-file-type">{comic.fileType}</span>
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

export default Library
