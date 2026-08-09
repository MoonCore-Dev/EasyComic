import { useState, useEffect } from 'react'
import './TitleBar.css'

interface TitleBarProps {
  onEnterImmersive: () => void
  onGoHome: () => void
}

function TitleBar({ onEnterImmersive, onGoHome }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const w = window as any
  const api = w.electronAPI?.window ?? w.windowAPI

  useEffect(() => {
    if (api) {
      api.isMaximized().then((maximized: boolean) => {
        setIsMaximized(maximized)
      })
    }
  }, [api])

  const handleMinimize = () => {
    if (api) api.minimize()
  }

  const handleMaximize = () => {
    if (api) {
      api.maximize().then((result: boolean) => {
        setIsMaximized(result)
      })
    }
  }

  const handleClose = () => {
    if (api) api.close()
  }

  return (
    <div className="titlebar">
      <div className="titlebar-drag-region">
        <span className="titlebar-title" onClick={onGoHome} style={{ cursor: 'pointer' }}>EasyComic</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-immersive"
          onClick={onEnterImmersive}
          aria-label="进入沉浸模式"
          title="进入沉浸模式"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M3 3H13V13H3Z" stroke="currentColor" strokeWidth="1" />
            <path d="M3 3H7M3 3V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M13 13H9M13 13V9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-minimize"
          onClick={handleMinimize}
          aria-label="最小化"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-maximize"
          onClick={handleMaximize}
          aria-label="最大化"
        >
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
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={handleClose}
          aria-label="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default TitleBar
