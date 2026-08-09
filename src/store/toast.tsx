import React, { createContext, useCallback, useContext, useState, useEffect } from 'react'
import { usePersisted } from '../comic/usePersisted'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  /** 可选：弹窗标识，用于"今日不再提示"记忆 */
  dismissibleId?: string
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void
  showConfirm: (opts: ConfirmOptions) => Promise<boolean>
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DISMISS_KEY = 'easycomic:dismissed'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function wasDismissedToday(id: string, map: Record<string, string> | null | undefined): boolean {
  if (!map) return false
  return map[id] === todayKey()
}

function cleanAndMark(map: Record<string, string> | null | undefined, id: string): Record<string, string> {
  const next: Record<string, string> = map ? { ...map } : {}
  const tk = todayKey()
  // 清理非今日的条目
  for (const k of Object.keys(next)) {
    if (next[k] !== tk) delete next[k]
  }
  next[id] = tk
  return next
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  // 使用持久化保存「今日不再提示」标记（升级安装保留）
  const { value: dismissMap, setValue: setDismissMap } = usePersisted<Record<string, string>>(DISMISS_KEY, {})
  // 跨日启动时立即清理过期标记（避免文件无限增长）
  useEffect(() => {
    const tk = todayKey()
    let changed = false
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(dismissMap ?? {})) {
      if (v === tk) { next[k] = v } else { changed = true }
    }
    if (changed) setDismissMap(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, type, duration }])
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }
  }, [])

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showConfirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    // 如果设置了 dismissibleId 且今日已勾选不再提示，直接返回 true（默认确认）
    if (opts.dismissibleId && wasDismissedToday(opts.dismissibleId, dismissMap ?? {})) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      setDontShowAgain(false)
      setConfirm({ ...opts, resolve })
      requestAnimationFrame(() => setConfirmVisible(true))
    })
  }, [dismissMap])

  const closeConfirm = useCallback((value: boolean) => {
    if (confirm) {
      if (value && dontShowAgain && confirm.dismissibleId) {
        setDismissMap(prev => cleanAndMark(prev ?? {}, confirm.dismissibleId!))
      }
      confirm.resolve(value)
      setConfirmVisible(false)
      setTimeout(() => setConfirm(null), 200)
    }
  }, [confirm, dontShowAgain, setDismissMap])

  const handleConfirm = useCallback(() => closeConfirm(true), [closeConfirm])
  const handleCancel = useCallback(() => closeConfirm(false), [closeConfirm])

  const value = { showToast, showConfirm }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-item toast-${t.type}`}
            onClick={() => hideToast(t.id)}
          >
            <ToastIcon type={t.type} />
            <span className="toast-message">{t.message}</span>
          </div>
        ))}
      </div>

      {confirm && (
        <div className={`confirm-overlay ${confirmVisible ? 'visible' : ''}`} onClick={handleCancel}>
          <div
            className={`confirm-dialog ${confirmVisible ? 'visible' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-title">{confirm.title}</div>
            <div className="confirm-message">{confirm.message}</div>
            {confirm.dismissibleId && (
              <label className="confirm-dismiss">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                />
                <span>今日不再提示</span>
              </label>
            )}
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn-cancel" onClick={handleCancel}>
                {confirm.cancelText || '取消'}
              </button>
              <button className="confirm-btn confirm-btn-ok" onClick={handleConfirm}>
                {confirm.confirmText || '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

function ToastIcon({ type }: { type: ToastType }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' }
  switch (type) {
    case 'success':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'warning':
      return (
        <svg {...common}>
          <path d="M12 3l9 17H3l9-17z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="0.8" fill="currentColor" />
        </svg>
      )
    case 'error':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
          <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
          <line x1="12" y1="10.5" x2="12" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="8" r="0.8" fill="currentColor" />
        </svg>
      )
  }
}
