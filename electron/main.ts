import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { readImageAsDataUrl, scanFolder, openComic, getPage, setPdfRenderer, type OpenComicResult, type ScannedComicFile, type ComicPage } from './comic-loader'
import { readStore, writeStore, deleteStore, deleteAllStore } from './store'

let mainWindow: BrowserWindow | null = null

const isDev = process.env.NODE_ENV === 'development'

/** 首屏加速：主进程同步预读各 store 文件，打包成 base64 JSON 通过命令行参数传给 preload。
 *  不能放在 preload 里读 fs——preload 默认运行在 sandbox 中，直接 import fs/path/os 会导致
 *  脚本崩溃，electronAPI 无法暴露，应用退化成 demo 模式（数据"消失"）。 */
function buildBootstrap(): Record<string, unknown> {
  const STORE_DIR = path.join(app.getPath('userData'), 'user-data')
  const FILE_MAP: Record<string, string> = {
    'easycomic:comics': 'comics.json',
    'easycomic:progress': 'reading-progress.json',
    'easycomic:removed-sources': 'removed-sources.json',
    'easycomic:reader-settings': 'reader-settings.json',
    'easycomic:sidebar-order': 'sidebar-order.json',
    'easycomic:sort-type': 'sort-type.json',
    'easycomic:dismissed': 'dismissed-dialogs.json'
  }
  const out: Record<string, unknown> = {}
  if (!fs.existsSync(STORE_DIR)) return out
  for (const [key, file] of Object.entries(FILE_MAP)) {
    try {
      const p = path.join(STORE_DIR, file)
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf-8')
      if (!raw.trim()) continue
      out[key] = JSON.parse(raw)
    } catch {
      /* 解析失败则忽略，渲染进程会走 IPC 兜底 */
    }
  }
  return out
}

// 开发模式下强制 Chromium / DevTools 以英文 locale 启动，避免顶部弹出
// "DevTools is now available in Chinese!" 的提示横幅。
if (isDev) {
  process.env.LANG = 'en-US'
  process.env.LC_ALL = 'en_US.UTF-8'
  process.env.LANGUAGE = 'en_US:en'
  app.commandLine.appendSwitch('lang', 'en-US')
}

// 全局：禁用 Windows/Linux 的 Fluent / 系统原生（overlay）滚动条，
// 让 Chromium 回退到经典滚动条，从而 ::-webkit-scrollbar 自定义样式（胶囊形）能够生效。
// 注意：绝不能 enable "OverlayScrollbar" —— 否则 Chromium 会自己绘制 Fluent 浮层滚动条，
// 完全忽略 webkit 自定义 CSS（这正是之前“滚动条改不成胶囊 + 隐藏按钮失效”的根因）。
// 关键：必须同时禁用 OverlayScrollbar，否则 Chromium 在 Windows 11 上会继续使用
// Fluent overlay 滚动条并完全忽略 ::-webkit-scrollbar CSS。
const disableFeatures = ['FluentScrollbar', 'FluentOverlayScrollbar', 'OverlayScrollbar']
if (isDev) disableFeatures.push('DevToolsLanguageDetection')
app.commandLine.appendSwitch('disable-features', disableFeatures.join(','))

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1E2020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 强制使用经典滚动条，确保 ::-webkit-scrollbar CSS 生效。
      // 命令行 disable-features 负责全局开关，disableBlinkFeatures 负责 Blink 层特性。
      disableBlinkFeatures: 'FluentScrollbar,FluentOverlayScrollbar,OverlayScrollbar'
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (isDev) {
    // 不再自动打开 DevTools，避免每次启动都弹出窗口。
    // 保留手动打开时关闭中文提示横幅的逻辑（F12 / Ctrl+Shift+I 仍可打开）。
    const hideDevToolsBanner = () => {
      const devTools = mainWindow?.webContents.devToolsWebContents
      if (!devTools || devTools.isDestroyed()) return
      const script = `
        (function(){
          const style = document.createElement('style');
          style.textContent = '.system-banner,.system-banner-container,.banner,.infobar,.locale-banner,.dev-toolbar,.suggested-lang-banner{display:none!important}';
          document.head.appendChild(style);
          document.querySelectorAll('.system-banner,.system-banner-container,.banner,.infobar,.locale-banner,.dev-toolbar,.suggested-lang-banner').forEach(el => el.remove());
        })();
      `
      devTools.executeJavaScript(script).catch(() => {})
    }
    mainWindow.webContents.on('devtools-opened', () => {
      hideDevToolsBanner()
      const devTools = mainWindow?.webContents.devToolsWebContents
      if (devTools && !devTools.isDestroyed()) {
        devTools.on('did-finish-load', hideDevToolsBanner)
      }
      // DevTools DOM 可能延迟加载，多次尝试
      setTimeout(hideDevToolsBanner, 500)
      setTimeout(hideDevToolsBanner, 1500)
      setTimeout(hideDevToolsBanner, 3000)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    // 销毁隐藏的 PDF 渲染窗口，否则它会阻止 window-all-closed 触发，
    // 导致主进程在后台残留（多次开关后出现多个 EasyComic 后台进程）。
    if (pdfRendererWindow && !pdfRendererWindow.isDestroyed()) {
      pdfRendererWindow.destroy()
      pdfRendererWindow = null
    }
  })
}

// ═══════════════════════════════════════════
// 隐藏 PDF 渲染窗口
// ═══════════════════════════════════════════
// PDF.js 依赖浏览器 DOM/canvas；若在 Electron 主进程（Node 环境）中加载
// 原生图形模块，会触发 STATUS_HEAP_CORRUPTION (0xC0000374)。
// 因此创建一个不可见的 BrowserWindow，在里面用 Chromium 原生 canvas 按需渲染
// 单页 PDF，再通过 IPC 把结果传回主进程（懒加载，避免一次性渲染全部页）。

let pdfRendererWindow: BrowserWindow | null = null

function createPdfRendererWindow() {
  if (pdfRendererWindow && !pdfRendererWindow.isDestroyed()) return

  pdfRendererWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  })

  pdfRendererWindow.on('closed', () => {
    onPdfWindowGone()
  })
  // 'crashed' 在运行时有效（隐藏渲染窗口崩溃时触发），但当前 @types/electron
  // 未将该事件收录进 webContents.on 的重载联合类型，故对 webContents 做局部转换。
  ;(pdfRendererWindow.webContents as any).on('crashed', () => {
    onPdfWindowGone()
  })

  // 构造内嵌 HTML，通过 data URL 加载，避免额外的静态文件分发。
  // 隐藏窗口的 origin 是 data: URL，需要 webSecurity:false 才能加载 file:// 的 pdfjs。
  const pdfjsPath = path.resolve(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')
  const workerPath = path.resolve(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script type="module">
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const pdfjsLib = await dynamicImport('file:///${pdfjsPath.replace(/\\/g, '/')}');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'file:///${workerPath.replace(/\\/g, '/')}';

  const { ipcRenderer } = require('electron');

  const MAX_OUTPUT_PX = 1920;
  const docCache = new Map(); // filePath -> { pdf, lastUsed }
  const MAX_DOCS = 2;

  async function getDoc(filePath) {
    let entry = docCache.get(filePath);
    if (entry) { entry.lastUsed = Date.now(); return entry.pdf; }
    const pdf = await pdfjsLib.getDocument(filePath).promise;
    entry = { pdf, lastUsed: Date.now() };
    docCache.set(filePath, entry);
    if (docCache.size > MAX_DOCS) {
      let oldestKey = null, oldest = Infinity;
      for (const [k, v] of docCache) { if (v.lastUsed < oldest) { oldest = v.lastUsed; oldestKey = k; } }
      if (oldestKey) docCache.delete(oldestKey);
    }
    return pdf;
  }

  async function renderPage(filePath, index) {
    const pdf = await getDoc(filePath);
    const page = await pdf.getPage(index + 1);
    const rawViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_OUTPUT_PX / Math.max(rawViewport.width, rawViewport.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { index, name: 'page-' + (index + 1) + '.jpg', dataUrl: canvas.toDataURL('image/jpeg', 0.92) };
  }

  ipcRenderer.on('pdf:open', async (event, { reqId, filePath }) => {
    try {
      const pdf = await getDoc(filePath);
      ipcRenderer.send('pdf:open-result', { reqId, success: true, pageCount: pdf.numPages });
    } catch (err) {
      ipcRenderer.send('pdf:open-result', { reqId, success: false, error: err?.message || String(err) });
    }
  });

  ipcRenderer.on('pdf:renderPage', async (event, { reqId, filePath, index }) => {
    try {
      const page = await renderPage(filePath, index);
      ipcRenderer.send('pdf:page-result', { reqId, success: true, page });
    } catch (err) {
      ipcRenderer.send('pdf:page-result', { reqId, success: false, error: err?.message || String(err) });
    }
  });
</script>
</body>
</html>`

  pdfRendererWindow.loadURL('data:text/html;base64,' + Buffer.from(html, 'utf-8').toString('base64'))
}

// ─── PDF 渲染请求管理（reqId 匹配 + 超时 + 窗口崩溃自愈）───
const pdfPending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>()
let pdfReqId = 0

function onPdfWindowGone() {
  for (const [, p] of pdfPending) {
    if (p.timer) clearTimeout(p.timer)
    p.reject(new Error('PDF 渲染窗口已关闭'))
  }
  pdfPending.clear()
  pdfRendererWindow = null
}

function ensurePdfWindow(): BrowserWindow | null {
  if (!pdfRendererWindow || pdfRendererWindow.isDestroyed()) {
    try { createPdfRendererWindow() } catch { return null }
  }
  return pdfRendererWindow
}

function pdfRequest<T>(send: (reqId: number) => void, timeoutMs = 30000): Promise<T> {
  const reqId = ++pdfReqId
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pdfPending.delete(reqId)
      reject(new Error('PDF 渲染超时'))
    }, timeoutMs)
    pdfPending.set(reqId, { resolve, reject, timer })
    send(reqId)
  })
}

// 把隐藏窗口的渲染能力注入 comic-loader。
setPdfRenderer({
  openPdf(filePath: string) {
    const win = ensurePdfWindow()
    if (!win) return Promise.reject(new Error('PDF 渲染窗口未创建'))
    return pdfRequest<{ pageCount: number }>((reqId) =>
      win.webContents.send('pdf:open', { reqId, filePath })
    )
  },
  renderPdfPage(filePath: string, index: number) {
    const win = ensurePdfWindow()
    if (!win) return Promise.reject(new Error('PDF 渲染窗口未创建'))
    return pdfRequest<ComicPage>((reqId) =>
      win.webContents.send('pdf:renderPage', { reqId, filePath, index })
    )
  }
})

ipcMain.on('pdf:open-result', (event, msg: { reqId: number; success: boolean; pageCount?: number; error?: string }) => {
  if (!pdfRendererWindow || event.sender !== pdfRendererWindow.webContents) return
  const p = pdfPending.get(msg.reqId)
  if (!p) return
  pdfPending.delete(msg.reqId)
  if (p.timer) clearTimeout(p.timer)
  if (msg.success && msg.pageCount != null) p.resolve({ pageCount: msg.pageCount })
  else p.reject(new Error(msg.error ?? 'PDF 打开失败'))
})

ipcMain.on('pdf:page-result', (event, msg: { reqId: number; success: boolean; page?: ComicPage; error?: string }) => {
  if (!pdfRendererWindow || event.sender !== pdfRendererWindow.webContents) return
  const p = pdfPending.get(msg.reqId)
  if (!p) return
  pdfPending.delete(msg.reqId)
  if (p.timer) clearTimeout(p.timer)
  if (msg.success && msg.page) p.resolve(msg.page)
  else p.reject(new Error(msg.error ?? 'PDF 渲染失败'))
})

app.whenReady().then(() => {
  createWindow()
  createPdfRendererWindow() // 预创建隐藏 PDF 渲染窗口

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 双保险：退出前确保隐藏的 PDF 渲染窗口被销毁，避免主进程残留。
app.on('before-quit', () => {
  if (pdfRendererWindow && !pdfRendererWindow.isDestroyed()) {
    pdfRendererWindow.destroy()
    pdfRendererWindow = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
    return false
  } else {
    mainWindow?.maximize()
    return true
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

ipcMain.handle('comic:pickFolder', async (): Promise<string | null> => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '导入漫画文件夹',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths.length) return null
  console.log(`[EasyComic] pickFolder: "${res.filePaths[0]}"`)
  return res.filePaths[0]
})

ipcMain.handle('comic:pickFile', async (): Promise<string | null> => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '打开漫画文件',
    properties: ['openFile'],
    filters: [
      {
        name: '漫画/压缩包',
        extensions: ['cbz', 'zip', 'cbt', 'tar', 'pdf', 'cbr', 'cb7', '7z', 'rar', 'epub', 'fb2']
      },
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
})

// ─── 打开漫画：只解析页结构 + 首图（不加载全部页面）───
ipcMain.handle('comic:load', async (_e, sourcePath: string): Promise<OpenComicResult> => {
  try {
    const result = await openComic(sourcePath)
    console.log(`[EasyComic] openComic("${sourcePath}"): ${result.pageCount} pages`)
    return result
  } catch (err: any) {
    console.error(`[EasyComic] openComic("${sourcePath}") error:`, err?.message)
    throw err
  }
})

// ─── 按需取单页（懒加载核心）：渲染进程只请求当前可见页及缓冲页 ───
ipcMain.handle('comic:loadPage', async (_e, sourcePath: string, index: number): Promise<ComicPage | null> => {
  try {
    return await getPage(sourcePath, index)
  } catch (err: any) {
    console.error(`[EasyComic] getPage("${sourcePath}", ${index}) error:`, err?.message)
    throw err
  }
})

ipcMain.handle('comic:scanFolder', (_e, folderPath: string): ScannedComicFile[] => {
  try {
    const results = scanFolder(folderPath)
    console.log(`[EasyComic] scanFolder("${folderPath}") found ${results.length} files`)
    if (results.length > 0) {
      results.forEach(r => console.log(`  - ${r.path}`))
    }
    return results
  } catch (err: any) {
    console.error(`[EasyComic] scanFolder error: ${err?.message}`)
    return []
  }
})

ipcMain.handle('comic:pickCoverImage', async (): Promise<{ dataUrl: string } | null> => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择封面图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'] }
    ]
  })
  if (res.canceled || !res.filePaths.length) return null
  const dataUrl = readImageAsDataUrl(res.filePaths[0])
  return { dataUrl }
})

// ─── 封面缩略图磁盘缓存 ───
// 书库不再持久化整张大图（base64），改为：导入时把首图缩成小缩略图写入
// user-data/covers/<id>.jpg，comics.json 只存相对路径 coverPath，启动/翻书库时按需读取。
// 这彻底解决 comics.json 随书库膨胀（每本存首图全分辨率 base64）导致的文件变大、启动变慢问题。
const USER_DATA_DIR = path.join(app.getPath('userData'), 'user-data')
const COVERS_DIR = path.join(USER_DATA_DIR, 'covers')

function ensureCoversDir(): void {
  if (!fs.existsSync(COVERS_DIR)) {
    fs.mkdirSync(COVERS_DIR, { recursive: true })
  }
}

/** 把相对/绝对封面路径统一解析为绝对路径 */
function resolveCoverPath(coverPath: string): string {
  if (!coverPath) return ''
  return path.isAbsolute(coverPath) ? coverPath : path.join(USER_DATA_DIR, coverPath)
}

ipcMain.handle('comic:saveCover', (_e, { id, dataUrl }: { id: string; dataUrl: string }): string | null => {
  try {
    if (!id || !dataUrl) return null
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
    if (!m) return null
    ensureCoversDir()
    const file = path.join(COVERS_DIR, `${id}.jpg`)
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'))
    // 返回相对路径，便于 userData 迁移/重定位
    return `covers/${id}.jpg`
  } catch (err: any) {
    console.error(`[EasyComic] saveCover("${id}") failed:`, err?.message ?? err)
    return null
  }
})

ipcMain.handle('comic:getCover', async (_e, coverPath: string): Promise<string | null> => {
  try {
    const file = resolveCoverPath(coverPath)
    if (!file || !fs.existsSync(file)) return null
    const buf = fs.readFileSync(file)
    const ext = path.extname(file).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err: any) {
    console.error(`[EasyComic] getCover("${coverPath}") failed:`, err?.message ?? err)
    return null
  }
})

ipcMain.handle('comic:deleteCover', (_e, coverPath: string): void => {
  try {
    const file = resolveCoverPath(coverPath)
    if (file && fs.existsSync(file)) fs.unlinkSync(file)
  } catch (err: any) {
    console.error(`[EasyComic] deleteCover("${coverPath}") failed:`, err?.message ?? err)
  }
})

// ═══ 用户数据持久化（存储在 userData/user-data/*.json 便于版本升级保留） ═══
ipcMain.handle('store:read', (_e: unknown, key: string) => readStore(key))
ipcMain.handle('store:write', (_e: unknown, key: string, value: unknown): boolean => writeStore(key, value))
ipcMain.handle('store:delete', (_e: unknown, key: string): boolean => deleteStore(key))
ipcMain.handle('store:clear-all', (): boolean => deleteAllStore())
// 首屏加速：preload 通过同步 IPC 获取主进程已读好的 store 快照，避免在 sandbox 中读 fs。
ipcMain.on('store:bootstrap', (event) => {
  event.returnValue = buildBootstrap()
})

// ═══ 应用信息 ═══
ipcMain.handle('app:getVersion', () => {
  const pkgPath = path.join(__dirname, '../package.json')
  try {
    const pkg = JSON.parse(require('fs').readFileSync(pkgPath, 'utf-8'))
    return pkg.version || '0.0.0'
  } catch {
    return '1.0.0'
  }
})

ipcMain.handle('app:relaunch', () => {
  // 生产模式：真正重启应用（先隐藏窗口避免闪烁）
  if (mainWindow) mainWindow.hide()
  app.relaunch()
  app.exit(0)
})

// 重启应用（统一入口）：开发/生产均做真正的进程级重启。
// 开发模式之所以能安全重启，是因为 electron:dev 脚本改用 --kill-others-on-fail（而非 -k）：
// Electron 退出重启时不会连带杀掉 Vite dev server，新实例可重连 localhost:5173。
// （若仍用 -k，dev 下 relaunch 会杀掉 Vite 导致断连白屏，那才会退化成仅 reload。）
ipcMain.handle('app:restart', () => {
  console.log('[EasyComic] restart: relaunch app (real process restart)')
  if (mainWindow) mainWindow.hide()
  app.relaunch()
  app.exit(0)
})

// 打开外部链接（如 GitHub Releases 下载页），用系统默认浏览器打开。
// 仅放行 http/https，避免任意协议被唤起。
ipcMain.handle('app:openExternal', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url)
  }
})
