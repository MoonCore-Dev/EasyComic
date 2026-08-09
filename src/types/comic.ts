export interface Comic {
  id: string
  title: string
  /** 文件路径或文件夹路径 */
  sourcePath: string
  /**
   * 封面缩略图的磁盘缓存相对路径（user-data/covers/<id>.jpg）。
   * 新导入的漫画只存这个路径，不再把整张图以 base64 写进 comics.json，
   * 从根本上避免书库文件随漫画数量膨胀。
   */
  coverPath?: string
  /**
   * 封面 dataUrl（旧版持久化字段 / 演示漫画 / 兜底显示）。
   * 新导入不再写入；迁移脚本会把旧 coverDataUrl 转成 coverPath 文件后清空本字段。
   */
  coverDataUrl?: string
  /** 用户是否手动更换过封面（刷新书库时不覆盖） */
  customCover?: boolean
  /** 总页数 */
  pageCount: number
  /** 阅读进度 0~1，0 表示未阅读 */
  progress: number
  /** 最后阅读时间（ms timestamp） */
  lastReadAt: number
  /** 添加时间（ms timestamp） */
  addedAt: number
  /** 是否在书库中隐藏 */
  hidden?: boolean
  /** 批量导入的批次ID（同一文件夹导入的漫画共享） */
  batchId?: string
  /** 批次来源文件夹路径（仅文件夹批量导入时有） */
  batchSource?: string
  /** 是否为文件夹单本（图片文件夹） */
  isFolder?: boolean
  /** 文件类型标签（如 EPUB, PDF, CBZ 等） */
  fileType?: string
}

export interface LoadedComic {
  comic: Comic
}

export type ViewType = 'library' | 'recent' | 'search' | 'import' | 'settings'
