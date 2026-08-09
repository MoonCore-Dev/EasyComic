import { contextBridge, ipcRenderer } from 'electron'

export interface ComicPage {
  index: number
  name: string
  dataUrl: string
}

export interface LoadComicResult {
  title: string
  source: string
  pageCount: number
  firstPage: ComicPage | null
  isFolder?: boolean
  fileType?: string
}

export interface ScannedComicFile {
  path: string
  title: string
}

// ═══ 首屏加速：通过同步 IPC 从主进程获取预读 store 数据 ═══
// 注意：preload 默认运行在 sandbox 中，不能直接 import fs/path/os。
// 所有文件读取都在主进程完成，这里只做一次同步 IPC 并把结果暴露给渲染进程。
function getBootstrap(): Record<string, unknown> {
  try {
    return ipcRenderer.sendSync('store:bootstrap') as Record<string, unknown>
  } catch {
    return {}
  }
}

// 暴露给渲染进程（结构化克隆）。usePersisted 在模块加载时同步灌入内存缓存，
// 使 initialized 在首帧即为 true，书库 / 设置首屏不再出现“加载中”闪烁。
const bootstrap = getBootstrap()
contextBridge.exposeInMainWorld('__EASYCOMIC_BOOTSTRAP__', bootstrap)

contextBridge.exposeInMainWorld('electronAPI', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },
  comic: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('comic:pickFolder'),
    pickFile: (): Promise<string | null> => ipcRenderer.invoke('comic:pickFile'),
    load: (source: string): Promise<LoadComicResult> => ipcRenderer.invoke('comic:load', source),
    loadPage: (source: string, index: number): Promise<ComicPage | null> => ipcRenderer.invoke('comic:loadPage', source, index),
    scanFolder: (folderPath: string): Promise<ScannedComicFile[]> => ipcRenderer.invoke('comic:scanFolder', folderPath),
    pickCoverImage: (): Promise<{ dataUrl: string } | null> => ipcRenderer.invoke('comic:pickCoverImage'),
    saveCover: ({ id, dataUrl }: { id: string; dataUrl: string }): Promise<string | null> => ipcRenderer.invoke('comic:saveCover', { id, dataUrl }),
    getCover: (coverPath: string): Promise<string | null> => ipcRenderer.invoke('comic:getCover', coverPath),
    deleteCover: (coverPath: string): Promise<void> => ipcRenderer.invoke('comic:deleteCover', coverPath)
  },
  // 用户数据持久化（主进程 userData 下的独立 JSON 文件，升级安装不丢失）
  store: {
    read: <T = unknown>(key: string): Promise<T | null> => ipcRenderer.invoke('store:read', key),
    write: <T = unknown>(key: string, value: T): Promise<boolean> => ipcRenderer.invoke('store:write', key, value),
    delete: (key: string): Promise<boolean> => ipcRenderer.invoke('store:delete', key),
    clearAll: (): Promise<boolean> => ipcRenderer.invoke('store:clear-all')
  },
  // 应用信息
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    restart: (): Promise<void> => ipcRenderer.invoke('app:restart')
  }
})
