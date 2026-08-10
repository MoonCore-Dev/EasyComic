import { useState, useCallback, useEffect } from 'react'
import { useReaderSettings } from '../comic/useReaderSettings'
import { useHomeSettings } from '../comic/useHomeSettings'
import type { ReaderSettings, ReaderUpdateFn } from '../comic/useReaderSettings'
import CustomScrollbar from './CustomScrollbar'
import './SettingsModal.css'

type SettingsTab = 'general' | 'reading' | 'data' | 'about'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onAllDataCleared: () => void
}

const GITHUB_REPO = 'MoonCore-Dev/EasyComic'

function SettingsModal({ open, onClose, onAllDataCleared }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const { settings, update, adjustZoom, resetZoom, currentZoom } = useReaderSettings()
  const { settings: homeSettings, update: updateHome } = useHomeSettings()
  const [version, setVersion] = useState('1.0.0')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [upToDate, setUpToDate] = useState(false)
  const [checkError, setCheckError] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (open) {
      setActiveTab('general')
      setDeleteConfirm(false)
      setUpdateAvailable(null)
      setUpToDate(false)
      setCheckError(false)
      setVersion('1.0.0')
      const api = (window as any).electronAPI
      if (api?.app?.getVersion) {
        api.app.getVersion().then((v: string) => setVersion(v)).catch(() => {})
      }
    }
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleClearAll = useCallback(async () => {
    setDeleting(true)
    try {
      await onAllDataCleared()
      onClose()
    } catch (err) {
      console.error('[SettingsModal] clear all data failed:', err)
    } finally {
      setDeleting(false)
      setDeleteConfirm(false)
    }
  }, [onAllDataCleared, onClose])

  const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`

  // 跳转到 GitHub Releases 页面（用系统默认浏览器打开），让用户自行下载更新
  const handleOpenUpdate = useCallback(() => {
    const api = (window as any).electronAPI
    if (api?.app?.openExternal) {
      api.app.openExternal(RELEASES_URL)
    } else {
      // 浏览器预览模式无 electronAPI，退回 window.open
      window.open(RELEASES_URL, '_blank')
    }
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true)
    setUpdateAvailable(null)
    setUpToDate(false)
    setCheckError(false)
    try {
      const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      if (resp.ok) {
        const data = await resp.json()
        const tag = data.tag_name?.replace(/^v/, '') ?? null
        if (tag && tag !== version) {
          // 有更新：记录最新版本号，UI 下方显示“有最新版本 x.x.x”+ 更新按钮
          setUpdateAvailable(tag)
        } else {
          // 已是最新（包括没有 tag 的情况）
          setUpToDate(true)
        }
      } else if (resp.status === 404) {
        // 仓库还没有发布任何 Release
        setUpToDate(true)
      } else {
        setCheckError(true)
      }
    } catch {
      setCheckError(true)
    } finally {
      setCheckingUpdate(false)
    }
  }, [version])

  if (!open) return null

  return (
    <div className="settings-modal-wrap" role="dialog" aria-modal="true">
      <div className="settings-modal-backdrop" onClick={onClose} />
      <div className="settings-modal">
        <div className="settings-modal-header">
          <h2 className="settings-modal-title">设置</h2>
          <button className="settings-modal-close" onClick={onClose} title="关闭 (Esc)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-body">
          {/* 左侧菜单 */}
          <nav className="settings-sidebar">
            <button
              className={`settings-sidebar-item ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>通用</span>
            </button>
            <button
              className={`settings-sidebar-item ${activeTab === 'reading' ? 'active' : ''}`}
              onClick={() => setActiveTab('reading')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 21c-2-1.5-4.5-2-7-2H3V4h2c2.5 0 5 .5 7 2v15z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 21c2-1.5 4.5-2 7-2h2V4h-2c-2.5 0-5 .5-7 2v15z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
              <span>阅读设置</span>
            </button>
            <button
              className={`settings-sidebar-item ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" stroke="currentColor" strokeWidth="1.8" />
              </svg>
              <span>用户数据</span>
            </button>
            <button
              className={`settings-sidebar-item ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 8v0M12 11h0a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0v-3h-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span>关于</span>
            </button>
          </nav>

          {/* 右侧内容区 */}
          <CustomScrollbar contentClassName="settings-content">
            {activeTab === 'general' && (
              <div className="settings-section">
                <div className="settings-section-header">
                  <h3>通用</h3>
                </div>
                <div className="settings-section-body">
                  {/* 主页设置子栏 */}
                  <div className="settings-sub-section">
                    <div className="settings-sub-header">
                      <h4>主页设置</h4>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">显示文件类型</span>
                      <div className="settings-btns">
                        <button
                          className={`settings-btn ${homeSettings.showFileType ? 'active' : ''}`}
                          onClick={() => updateHome('showFileType', !homeSettings.showFileType)}
                        >
                          {homeSettings.showFileType ? '显示' : '隐藏'}
                        </button>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">虚化背景</span>
                      <div className="settings-btns">
                        <button
                          className={`settings-btn ${homeSettings.backdropBlurEnabled ? 'active' : ''}`}
                          onClick={() => updateHome('backdropBlurEnabled', !homeSettings.backdropBlurEnabled)}
                        >
                          {homeSettings.backdropBlurEnabled ? '开启' : '关闭'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 诊断面板子栏 */}
                  <div className="settings-sub-section">
                    <div className="settings-sub-header">
                      <h4>诊断面板</h4>
                    </div>
                    <div className="settings-row">
                      <span className="settings-label">常显诊断面板</span>
                      <div className="settings-btns">
                        <button
                          className={`settings-btn ${homeSettings.alwaysShowDebugPanel ? 'active' : ''}`}
                          onClick={() => updateHome('alwaysShowDebugPanel', !homeSettings.alwaysShowDebugPanel)}
                        >
                          {homeSettings.alwaysShowDebugPanel ? '开启' : '关闭'}
                        </button>
                      </div>
                    </div>
                    <p className="settings-hint">关闭时，若当前页加载失败会自动显示诊断面板；快捷键 Ctrl+D 可手动切换。</p>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'reading' && (
              <ReadingSettingsPanel settings={settings} update={update} adjustZoom={adjustZoom} resetZoom={resetZoom} currentZoom={currentZoom} />
            )}
            {activeTab === 'data' && (
              <div className="settings-section">
                <div className="settings-section-header">
                  <h3>用户数据</h3>
                </div>
                <div className="settings-section-body">
                  <p className="settings-data-notice">
                    所有数据仅保存在本地，不会上传到任何服务器。
                  </p>
                  <p className="settings-data-desc">
                    这将删除所有漫画、阅读进度、设置、收藏等用户数据。此操作不可撤销。
                  </p>
                  <div className="settings-danger-row">
                    {!deleteConfirm ? (
                      <button
                        className="settings-btn-danger"
                        onClick={() => setDeleteConfirm(true)}
                      >
                        删除所有用户数据
                      </button>
                    ) : deleting ? (
                      <div className="settings-deleting-box">
                        <div className="settings-deleting-spinner" />
                        <span className="settings-deleting-text">正在删除中…</span>
                      </div>
                    ) : (
                      <div className="settings-confirm-box">
                        <p className="settings-confirm-text">
                          确定要删除所有用户数据吗？
                        </p>
                        <div className="settings-confirm-btns">
                          <button
                            className="settings-btn-secondary"
                            onClick={() => setDeleteConfirm(false)}
                          >
                            取消
                          </button>
                          <button
                            className="settings-btn-danger"
                            onClick={handleClearAll}
                          >
                            确认删除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'about' && (
              <div className="settings-section">
                <div className="settings-section-header">
                  <h3>关于 EasyComic</h3>
                </div>
                <div className="settings-section-body">
                  <div className="settings-about-row">
                    <span className="settings-about-label">应用名称</span>
                    <span className="settings-about-value">EasyComic</span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">开发者</span>
                    <span className="settings-about-value">MoonCore-Dev</span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">版本</span>
                    <span className="settings-about-value">{version}</span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">更新</span>
                    <div className="settings-update-area">
                      <button
                        className="settings-btn-secondary"
                        onClick={handleCheckUpdate}
                        disabled={checkingUpdate}
                      >
                        {checkingUpdate ? '检查中...' : '检查更新'}
                      </button>
                      {updateAvailable && (
                        <div className="settings-update-result">
                          <span className="settings-update-available">有最新版本 {updateAvailable}</span>
                          <button className="settings-btn-primary" onClick={handleOpenUpdate}>
                            更新
                          </button>
                        </div>
                      )}
                      {upToDate && <span className="settings-update-uptodate">已是最新版本</span>}
                      {checkError && <span className="settings-update-error">检查失败，请稍后重试</span>}
                    </div>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">重启应用</span>
                    <button
                      className="settings-btn-secondary"
                      onClick={async () => {
                        const api = (window as any).electronAPI
                        if (api?.app?.restart) {
                          // 由主进程根据开发/生产模式决定：开发重载渲染、生产重启进程
                          await api.app.restart()
                        } else {
                          // 无 API（浏览器预览模式）：直接刷新页面
                          window.location.reload()
                        }
                      }}
                    >
                      重启
                    </button>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">反馈问题</span>
                    <button
                      className="settings-btn-secondary"
                      onClick={() => {
                        const api = (window as any).electronAPI
                        const url = `https://github.com/${GITHUB_REPO}/issues/new`
                        if (api?.app?.openExternal) {
                          api.app.openExternal(url)
                        } else {
                          window.open(url, '_blank')
                        }
                      }}
                    >
                      反馈问题
                    </button>
                  </div>
                  <div className="settings-about-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                    <span className="settings-about-label">免责声明</span>
                    <p className="settings-about-value" style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.9, margin: 0 }}>
                      本软件仅用于个人合法拥有的漫画内容阅读，不提供任何漫画资源，不鼓励或支持盗版。用户使用本软件阅读非授权内容产生的法律风险由用户自行承担，开发者不承担任何责任。
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CustomScrollbar>
        </div>
      </div>
    </div>
  )
}

// ─── 阅读设置子组件（复用 ComicReader 的 SettingsPanel 逻辑，重新排版） ───
function ReadingSettingsPanel({
  settings,
  update,
  adjustZoom,
  resetZoom,
  currentZoom,
}: {
  settings: ReaderSettings
  update: ReaderUpdateFn
  adjustZoom: ReturnType<typeof useReaderSettings>['adjustZoom']
  resetZoom: ReturnType<typeof useReaderSettings>['resetZoom']
  currentZoom: number
}) {
  const maxZoomLabel = settings.mode === 'stitch' ? '400%' : '100%'

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>阅读设置</h3>
      </div>
      <div className="settings-section-body">
        {/* 阅读模式 */}
        <div className="settings-row">
          <span className="settings-label">阅读模式</span>
          <div className="settings-btns">
            {(['single', 'double', 'stitch'] as const).map(m => (
              <button
                key={m}
                className={`settings-btn ${settings.mode === m ? 'active' : ''}`}
                onClick={() => update('mode', m)}
              >
                {m === 'single' ? '单页' : m === 'double' ? '双页' : '滚动'}
              </button>
            ))}
          </div>
        </div>

        {/* 翻页动效 */}
        <div className="settings-row">
          <span className="settings-label">翻页动效</span>
          <div className="settings-btns">
            {(['flip', 'slide', 'none'] as const).map(a => (
              <button
                key={a}
                className={`settings-btn ${settings.animation === a ? 'active' : ''}`}
                onClick={() => update('animation', a)}
              >
                {a === 'flip' ? '仿真翻书' : a === 'slide' ? '滑入' : '无'}
              </button>
            ))}
          </div>
        </div>

        {/* 页面填充 */}
        <div className="settings-row">
          <span className="settings-label">页面填充</span>
          <div className="settings-btns">
            {(['contain', 'cover'] as const).map(f => (
              <button
                key={f}
                className={`settings-btn ${settings.pageFill === f ? 'active' : ''}`}
                onClick={() => update('pageFill', f)}
                title={f === 'contain' ? '保持比例，可能有黑边' : '占满容器，可能裁剪'}
              >
                {f === 'contain' ? '适应' : '填充'}
              </button>
            ))}
          </div>
        </div>

        {/* 页面顺序 */}
        <div className="settings-row">
          <span className="settings-label">页面顺序</span>
          <div className="settings-btns">
            <button
              className={`settings-btn ${settings.pageOrder === 'normal' ? 'active' : ''}`}
              onClick={() => update('pageOrder', 'normal')}
            >普通（左翻）</button>
            <button
              className={`settings-btn ${settings.pageOrder === 'japanese' ? 'active' : ''}`}
              onClick={() => update('pageOrder', 'japanese')}
            >日式（右翻）</button>
          </div>
        </div>

        {/* 缩放 */}
        <div className="settings-row">
          <span className="settings-label" title={`当前模式上限 ${maxZoomLabel}`}>缩放 (最大 {maxZoomLabel})</span>
          <div className="settings-btns">
            <button
              className="settings-btn"
              onClick={() => adjustZoom(-0.1)}
            >−</button>
            <span className="settings-value">{Math.round(currentZoom * 100)}%</span>
            <button
              className="settings-btn"
              onClick={() => adjustZoom(0.1)}
            >+</button>
            <button className="settings-btn" onClick={resetZoom}>重置</button>
          </div>
        </div>

        {/* 页码显示 */}
        <div className="settings-row">
          <span className="settings-label">小页码</span>
          <div className="settings-btns">
            <button
              className={`settings-btn ${settings.showPageNumber ? 'active' : ''}`}
              onClick={() => update('showPageNumber', true)}
            >显示</button>
            <button
              className={`settings-btn ${!settings.showPageNumber ? 'active' : ''}`}
              onClick={() => update('showPageNumber', false)}
            >隐藏</button>
          </div>
        </div>

        {/* 滚动条 */}
        <div className="settings-row">
          <span className="settings-label" title="仅在滚动模式下生效">滚动条</span>
          <div className="settings-btns">
            <button
              className={`settings-btn ${!settings.hideScrollbar ? 'active' : ''}`}
              onClick={() => update('hideScrollbar', false)}
            >显示</button>
            <button
              className={`settings-btn ${settings.hideScrollbar ? 'active' : ''}`}
              onClick={() => update('hideScrollbar', true)}
            >隐藏</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
