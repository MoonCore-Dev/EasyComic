/// <reference types="vite/client" />

export interface ComicPage {
  index: number
  name: string
  dataUrl: string
}

export interface LoadComicResult {
  title: string
  source: string
  /** 总页数 */
  pageCount: number
  /** 仅首图，用于生成封面缩略图；取不到时为 null */
  firstPage: ComicPage | null
  isFolder?: boolean
  /** 文件/文件夹对应的格式标签（如 ZIP / PNG / JPG / 混合 等） */
  fileType?: string
}

export interface ScannedComicFile {
  path: string
  title: string
}

interface WindowAPI {
  minimize: () => Promise<void>
  maximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
}

interface ComicAPI {
  pickFolder: () => Promise<string | null>
  pickFile: () => Promise<string | null>
  load: (source: string) => Promise<LoadComicResult>
  /** 按需取单页（懒加载）：返回指定页的 base64，取不到返回 null */
  loadPage: (source: string, index: number) => Promise<ComicPage | null>
  scanFolder: (folderPath: string) => Promise<ScannedComicFile[]>
  pickCoverImage: () => Promise<{ dataUrl: string } | null>
  /** 将缩略图 dataUrl 落盘缓存到 user-data/covers/<id>.jpg，返回相对路径（comics.json 只存该路径） */
  saveCover: (args: { id: string; dataUrl: string }) => Promise<string | null>
  /** 根据封面相对/绝对路径读取缩略图，返回 dataUrl（用于书库按需显示） */
  getCover: (coverPath: string) => Promise<string | null>
  /** 删除缓存的封面文件（移除漫画时调用） */
  deleteCover: (coverPath: string) => Promise<void>
}

interface StoreAPI {
  /** 从用户数据目录读取指定键（独立 JSON 文件存储，升级安装保留） */
  read: <T = unknown>(key: string) => Promise<T | null>
  /** 写入用户数据目录；成功返回 true */
  write: <T = unknown>(key: string, value: T) => Promise<boolean>
  /** 删除一个用户数据键 */
  delete: (key: string) => Promise<boolean>
  /** 清空所有用户数据 */
  clearAll: () => Promise<boolean>
}

interface AppAPI {
  /** 获取当前应用版本号 */
  getVersion: () => Promise<string>
  /** 强制重启整个应用（生产模式真正重启进程） */
  relaunch: () => Promise<void>
  /** 重启应用：开发模式重载渲染进程、生产模式重启进程（推荐使用入口） */
  restart: () => Promise<void>
}

interface ElectronAPI {
  window: WindowAPI
  comic: ComicAPI
  store: StoreAPI
  app: AppAPI
}

interface Window {
  windowAPI?: WindowAPI
  electronAPI?: ElectronAPI
}
