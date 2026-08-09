import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ViewType } from '../types/comic'
import { usePersisted } from '../comic/usePersisted'
import './Sidebar.css'

interface SidebarProps {
  currentView: ViewType
  onViewChange: (view: ViewType) => void
  isImmersive: boolean
  onExitImmersive: () => void
  onFirstViewChange: (view: ViewType) => void
  settingsOpen?: boolean
}

interface MenuItem {
  view: ViewType
  label: string
  icon: React.ReactNode
}

const STORAGE_KEY = 'easycomic:sidebar-order'

const defaultMenuItems: MenuItem[] = [
  {
    view: 'library',
    label: '书库',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M4 4h6v16H4V4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 4h6v16h-6V4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M16 6l4-1v14l-4 1" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    view: 'recent',
    label: '最近阅读',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    view: 'search',
    label: '搜索',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  },
  {
    view: 'import',
    label: '导入漫画文件夹',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="9" y1="14" x2="15" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
]

const settingsItem: MenuItem = {
  view: 'settings',
  label: '设置',
  icon: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function restoreOrder(storedViews: ViewType[] | null | undefined): MenuItem[] {
    const order = storedViews ?? []
    const map = new Map(defaultMenuItems.map(item => [item.view, item]))
    const sorted = order
      .filter(v => map.has(v as ViewType))
      .map(v => map.get(v as ViewType)!)
    const missing = defaultMenuItems.filter(item => !sorted.find(s => s.view === item.view))
    return [...sorted, ...missing]
  }

function Sidebar({ currentView, onViewChange, isImmersive, onExitImmersive, onFirstViewChange, settingsOpen }: SidebarProps) {
  const { value: storedViews, setValue: setStoredViews } = usePersisted<ViewType[]>(STORAGE_KEY, defaultMenuItems.map(i => i.view))
  const [items, setItems] = useState<MenuItem[]>(() => restoreOrder(storedViews as ViewType[] | undefined))

  // 当从持久化层异步读取到数据后，同步内存 items（但不覆盖 items 的拖拽操作）
  useEffect(() => {
    setItems(prev => {
      if (JSON.stringify(prev.map(i => i.view)) === JSON.stringify(storedViews)) return prev
      return restoreOrder(storedViews as ViewType[] | undefined)
    })
  }, [storedViews])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const offsetRef = useRef<Map<string, number>>(new Map())
  const navRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onFirstViewChange(items[0].view)
  }, [items, onFirstViewChange])

  // 当 items（拖拽后）变化时，同步写回持久化层
  useEffect(() => {
    setStoredViews(items.map(i => i.view))
  }, [items, setStoredViews])
  void useMemo

  const snapshotOffsets = useCallback(() => {
    if (!navRef.current) return
    offsetRef.current.clear()
    const buttons = navRef.current.querySelectorAll<HTMLElement>('[data-btn-key]')
    buttons.forEach((el: HTMLElement) => {
      const key = el.getAttribute('data-btn-key')
      if (key) {
        const rect = el.getBoundingClientRect()
        offsetRef.current.set(key, rect.top)
      }
    })
  }, [])

  const playFlipAnimation = useCallback(() => {
    if (!navRef.current) return
    const buttons = navRef.current.querySelectorAll<HTMLElement>('[data-btn-key]')
    buttons.forEach((el: HTMLElement) => {
      const key = el.getAttribute('data-btn-key')
      if (!key) return
      const prev = offsetRef.current.get(key)
      if (prev === undefined) return
      const current = el.getBoundingClientRect().top
      const delta = prev - current
      if (Math.abs(delta) > 0.1) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${delta}px)`
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = ''
            el.style.transform = ''
          })
        })
      }
    })
  }, [])

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
    snapshotOffsets()
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return
    setDragOverIndex(index)
    snapshotOffsets()
    setItems(prev => {
      const next = [...prev]
      const tmp = next[draggedIndex]
      next[draggedIndex] = next[index]
      next[index] = tmp
      return next
    })
    playFlipAnimation()
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" ref={navRef}>
        {items.map((item, index) => (
          <SidebarButton
            key={item.view}
            data-btn-key={item.view}
            item={item}
            active={currentView === item.view}
            onClick={() => onViewChange(item.view)}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            isDragging={draggedIndex === index}
            isDragOver={dragOverIndex === index && draggedIndex !== index}
          />
        ))}
      </nav>

      <div className="sidebar-bottom">
        {isImmersive && (
          <button
            className="sidebar-btn sidebar-btn-exit-immersive"
            onClick={onExitImmersive}
            aria-label="退出沉浸模式"
          >
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="sidebar-tooltip">退出沉浸模式</span>
          </button>
        )}
        <SidebarButton
          item={settingsItem}
          active={settingsOpen === true}
          onClick={() => onViewChange(settingsItem.view)}
        />
      </div>
    </aside>
  )
}

interface SidebarButtonProps {
  item: MenuItem
  active: boolean
  onClick: () => void
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isDragging?: boolean
  isDragOver?: boolean
  'data-btn-key'?: string
}

function SidebarButton({
  item,
  active,
  onClick,
  draggable,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
  isDragOver,
  'data-btn-key': dataBtnKey
}: SidebarButtonProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      className={`sidebar-btn ${active ? 'sidebar-btn-active' : ''} ${isDragging ? 'sidebar-btn-dragging' : ''} ${isDragOver ? 'sidebar-btn-drag-over' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      data-btn-key={dataBtnKey}
    >
      {item.icon}
      {hovered && <span className="sidebar-tooltip">{item.label}</span>}
    </button>
  )
}

export default Sidebar
