import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'
import JSZip from 'jszip'
import * as tar from 'tar-stream'
import { unpack as unpack7z, config as config7z } from '7zip-min'

/** 7zip-min 在 asar 包内无法直接 spawn .exe，需要指向 electron-builder 抽出的 unpacked 路径 */
function getSevenZipBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? '7za.exe' : '7za'
  const platformDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  if (app.isPackaged) {
    return path.join(__dirname, '..', '..', 'app.asar.unpacked', 'node_modules', '7zip-bin', platformDir, process.arch, binaryName)
  }
  // dev: dist-electron 的上一级就是项目根目录
  return path.join(__dirname, '..', 'node_modules', '7zip-bin', platformDir, process.arch, binaryName)
}

config7z({ binaryPath: getSevenZipBinaryPath() })

export interface ComicPage {
  index: number
  name: string
  dataUrl: string
}

export interface OpenComicResult {
  title: string
  source: string
  pageCount: number
  /** 仅首图，用于生成封面缩略图；取不到时为 null（封面走兜底） */
  firstPage: ComicPage | null
  isFolder?: boolean
  /** 文件/文件夹对应的格式标签（如 ZIP / PNG / JPG / 混合 等） */
  fileType?: string
}

// ═══════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff'])

const IGNORED_DIRS = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini', '@eaDir', '.thumbnails', 'thumbnails'])
const IGNORED_FILE_BASENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

/** 所有支持的压缩包/文档格式 → 类型映射 */
const ARCHIVE_EXTS: Record<string, 'zip' | 'rar' | '7z' | 'tar' | 'pdf' | 'epub' | 'fb2'> = {
  '.cbz': 'zip', '.zip': 'zip',
  '.cbr': 'rar', '.rar': 'rar',
  '.cb7': '7z',  '.7z': '7z',
  '.cbt': 'tar', '.tar': 'tar',
  '.pdf': 'pdf',
  '.epub': 'epub',
  '.fb2': 'fb2'
}

/** 可嵌套的压缩包格式（递归解压用；PDF/EPUB/FB2 是文档格式，不递归） */
const NESTABLE_EXTS = new Set(['.cbz', '.zip', '.cbr', '.rar', '.cb7', '.7z', '.cbt', '.tar'])

// ═══════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════

function isIgnoredEntry(name: string): boolean {
  const lower = name.toLowerCase().replace(/\\/g, '/')
  const parts = lower.split('/')
  for (const p of parts) {
    if (IGNORED_DIRS.has(p)) return true
  }
  const base = parts[parts.length - 1] ?? ''
  if (IGNORED_FILE_BASENAMES.has(base)) return true
  if (base.startsWith('.') && base !== '.') return true
  return false
}

function isImageFile(name: string): boolean {
  if (!IMAGE_EXTS.has(path.extname(name).toLowerCase())) return false
  if (isIgnoredEntry(name)) return false
  return true
}

/** 把扩展名映射为展示用的格式标签 */
function extToFileTypeLabel(ext: string): string {
  const map: Record<string, string> = {
    '.cbz': 'CBZ', '.zip': 'ZIP',
    '.cbr': 'CBR', '.rar': 'RAR',
    '.cb7': 'CB7', '.7z': '7Z',
    '.cbt': 'CBT', '.tar': 'TAR',
    '.pdf': 'PDF',
    '.epub': 'EPUB',
    '.fb2': 'FB2',
    '.jpg': 'JPG', '.jpeg': 'JPG', '.png': 'PNG', '.webp': 'WEBP',
    '.avif': 'AVIF', '.gif': 'GIF', '.bmp': 'BMP', '.tif': 'TIFF', '.tiff': 'TIFF'
  }
  return map[ext.toLowerCase()] || ext.toUpperCase().replace('.', '')
}

/** 推断漫画的文件类型标签
 *  - 文件漫画：根据扩展名返回（如 ZIP / PDF）
 *  - 图片文件夹：扫描 descriptors 中图片的扩展名，取数量最多的格式；多种格式并列第一时返回“混合”
 */
function inferFileType(sourcePath: string, isFolder: boolean, descriptors: PageDescriptor[]): string {
  if (!isFolder) {
    return extToFileTypeLabel(path.extname(sourcePath))
  }
  const counts = new Map<string, number>()
  for (const d of descriptors) {
    const name = d.name
    const ext = path.extname(name).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const label = extToFileTypeLabel(ext)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  if (counts.size === 0) return '图片文件夹'
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return '混合'
  return sorted[0][0]
}

function isNestedArchive(name: string): boolean {
  const ext = path.extname(name).toLowerCase()
  return NESTABLE_EXTS.has(ext)
}

// ─── 自然排序 ───
function naturalSplit(s: string): (string | number)[] {
  const result: (string | number)[] = []
  const re = /(\d+)|(\D+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m[1] != null) result.push(parseInt(m[1], 10))
    else if (m[2] != null) result.push(m[2].toLowerCase())
  }
  return result
}

function compareNatural(a: (string | number)[], b: (string | number)[]): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i], y = b[i]
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else {
      const xs = String(x), ys = String(y)
      if (xs !== ys) return xs < ys ? -1 : 1
    }
  }
  return a.length - b.length
}

function fullSortKey(name: string): (string | number)[] {
  const normalized = name.replace(/\\/g, '/')
  const basename = normalized.split('/').pop() ?? name
  const noExt = basename.replace(/\.[^.]+$/, '')
  const primary = naturalSplit(noExt)
  const parts = normalized.split('/')
  const secondary: (string | number)[] = []
  for (const p of parts) secondary.push(...naturalSplit(p))
  return [...primary, ...secondary]
}

// ─── Base64 / MIME ───
function toBase64(buf: Uint8Array, mime: string): string {
  let binary = ''
  const len = buf.length
  const chunk = 0x8000
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk) as any))
  }
  const b64 = btoa(binary)
  return `data:${mime};base64,${b64}`
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.png':  return 'image/png'
    case '.webp': return 'image/webp'
    case '.avif': return 'image/avif'
    case '.gif':  return 'image/gif'
    case '.bmp':  return 'image/bmp'
    case '.tif': case '.tiff': return 'image/tiff'
    default: return 'image/png'
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] ?? c))
}

/** 单文件损坏/缺失时的占位页 */
function makePlaceholderPage(index: number, name: string): ComicPage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200">
    <rect width="800" height="1200" fill="#2A2A2E"/>
    <text x="400" y="580" text-anchor="middle" font-size="24" fill="#888">图片损坏</text>
    <text x="400" y="620" text-anchor="middle" font-size="14" fill="#666">${escapeXml(path.basename(name))}</text>
  </svg>`
  return { index, name, dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` }
}

// ═══════════════════════════════════════════
// EPUB 辅助（按 OPF spine 顺序解析图片路径）
// ═══════════════════════════════════════════

function extractAttr(tag: string, attr: string): string | null {
  const regex = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i')
  const match = tag.match(regex)
  return match ? match[1] : null
}

function resolveZipPath(baseDir: string, relativePath: string): string {
  let rel = relativePath.replace(/^\//, '')
  try { rel = decodeURIComponent(rel) } catch { /* keep original */ }
  if (!baseDir) return rel
  const parts = `${baseDir}/${rel}`.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part === '.' || part === '') continue
    else resolved.push(part)
  }
  return resolved.join('/')
}

function extractOpfPath(containerXml: string): string | null {
  const match = containerXml.match(/<(?:\w+:)?rootfile[^>]*full-path=["']([^"']+)["']/i)
  return match ? match[1] : null
}

function parseManifest(opfXml: string): Map<string, { href: string; mediaType: string }> {
  const manifest = new Map<string, { href: string; mediaType: string }>()
  const regex = /<(?:\w+:)?item\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(opfXml)) !== null) {
    const tag = match[0]
    const id = extractAttr(tag, 'id')
    const href = extractAttr(tag, 'href')
    const mediaType = extractAttr(tag, 'media-type') || ''
    if (id && href) manifest.set(id, { href, mediaType })
  }
  return manifest
}

function parseSpine(opfXml: string): string[] {
  const spine: string[] = []
  const spineMatch = opfXml.match(/<(?:\w+:)?spine\b[^>]*>([\s\S]*?)<\/(?:\w+:)?spine>/i)
  if (!spineMatch) return spine
  const regex = /<(?:\w+:)?itemref\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(spineMatch[1])) !== null) {
    const idref = extractAttr(match[0], 'idref')
    if (idref) spine.push(idref)
  }
  return spine
}

function extractImageSrcs(xhtml: string): string[] {
  const srcs: string[] = []
  const imgRegex = /<(?:\w+:)?img\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imgRegex.exec(xhtml)) !== null) {
    const src = extractAttr(match[0], 'src')
    if (src) srcs.push(src.split('#')[0])
  }
  const svgImgRegex = /<(?:\w+:)?image\b[^>]*>/gi
  while ((match = svgImgRegex.exec(xhtml)) !== null) {
    const href = extractAttr(match[0], 'href') || extractAttr(match[0], 'xlink:href')
    if (href) srcs.push(href.split('#')[0])
  }
  return srcs.filter(Boolean)
}

// ═══════════════════════════════════════════
// 懒加载架构
// ═══════════════════════════════════════════
//
// 关键设计：openComic 只解析"页描述符"（不含图片像素数据），
// getPage(sourcePath, index) 才按需读取/渲染单页 base64。
// 主进程用 LRU 缓存已打开的漫画（最多 3 本），切换时自动清理临时目录，
// 避免一次性把整本漫画的 base64 塞进渲染进程导致 OOM / 卡顿。

// PDF 渲染由主进程内的隐藏 BrowserWindow 完成（浏览器原生 canvas），
// 避免在 Node/Electron 主进程加载原生图形模块触发 STATUS_HEAP_CORRUPTION。
export interface PdfRenderer {
  openPdf(filePath: string): Promise<{ pageCount: number }>
  renderPdfPage(filePath: string, index: number): Promise<ComicPage>
}

let pdfRenderer: PdfRenderer | null = null
export function setPdfRenderer(renderer: PdfRenderer) {
  pdfRenderer = renderer
}

// ─── 页描述符 ───
type PageDescriptor =
  | { kind: 'file'; path: string; name: string }
  | { kind: 'zipEntry'; zip: JSZip; name: string }
  | { kind: 'pdf'; name: string }
  | { kind: 'fb2'; ext: string; b64: string; name: string }

interface OpenedComic {
  source: string
  title: string
  isFolder: boolean
  descriptors: PageDescriptor[]
  tempDirs: string[]
  fileType: string
  lastUsed: number
}

const sourceCache = new Map<string, OpenedComic>()
const MAX_CACHE_ENTRIES = 3

function evictCache(): void {
  if (sourceCache.size <= MAX_CACHE_ENTRIES) return
  let oldestKey: string | null = null
  let oldest = Infinity
  for (const [k, v] of sourceCache) {
    if (v.lastUsed < oldest) { oldest = v.lastUsed; oldestKey = k }
  }
  if (!oldestKey) return
  const v = sourceCache.get(oldestKey)!
  // 释放 zip 引用（避免持有整本压缩包在内存）
  for (const d of v.descriptors) {
    if (d.kind === 'zipEntry') (d as { zip: JSZip | null }).zip = null
  }
  for (const t of v.tempDirs) {
    try { fs.rmSync(t, { recursive: true, force: true }) } catch { /* noop */ }
  }
  sourceCache.delete(oldestKey)
}

// ─── 文件夹：递归列出图片（含嵌套压缩包展开），仅记录路径不读数据 ───
async function listFolderDescriptors(
  folderPath: string,
  prefix: string,
  out: { descriptors: PageDescriptor[]; tempDirs: string[] }
): Promise<void> {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(folderPath, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    const abs = path.join(folderPath, e.name)
    if (e.isDirectory()) {
      if (isIgnoredEntry(rel + '/placeholder')) continue
      try {
        await listFolderDescriptors(abs, rel, out)
      } catch (err: any) {
        console.warn(`[EasyComic] listFolder failed: ${rel}: ${err}`)
      }
    } else if (e.isFile()) {
      if (isNestedArchive(e.name)) {
        const ext = path.extname(e.name).toLowerCase()
        const tmpPath = path.join(os.tmpdir(), `ec-nested-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
        try {
          fs.copyFileSync(abs, tmpPath)
          const sub = await buildFileDescriptors(tmpPath)
          for (const d of sub.descriptors) {
            if (d.kind === 'file') d.name = `${rel}/${d.name}`
          }
          out.descriptors.push(...sub.descriptors)
          out.tempDirs.push(...sub.tempDirs, tmpPath)
        } catch (err: any) {
          console.warn(`[EasyComic] nested archive in folder failed: ${rel}: ${err}`)
        }
      } else if (isImageFile(rel)) {
        out.descriptors.push({ kind: 'file', path: abs, name: rel })
      }
    }
  }
}

// ─── ZIP/CBZ：建立 zipEntry 描述符（含嵌套压缩包递归展开）───
async function buildZipDescriptors(filePath: string): Promise<{ descriptors: PageDescriptor[]; tempDirs: string[] }> {
  const data = fs.readFileSync(filePath)
  const zip = await JSZip.loadAsync(data)
  const descriptors: PageDescriptor[] = []
  const tempDirs: string[] = []
  const entries = Object.values(zip.files).filter(e => !e.dir)
  entries.sort((a, b) => compareNatural(fullSortKey(a.name), fullSortKey(b.name)))
  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) continue
    if (isNestedArchive(entry.name)) {
      const ext = path.extname(entry.name).toLowerCase()
      const tmpPath = path.join(os.tmpdir(), `ec-nested-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
      try {
        const buf = await entry.async('uint8array')
        fs.writeFileSync(tmpPath, buf)
        const sub = await buildFileDescriptors(tmpPath)
        for (const d of sub.descriptors) {
          if (d.kind === 'file') d.name = `${entry.name}/${d.name}`
        }
        descriptors.push(...sub.descriptors)
        tempDirs.push(...sub.tempDirs, tmpPath)
      } catch (err: any) {
        console.warn(`[EasyComic] nested archive in zip failed: ${entry.name}: ${err}`)
      }
    } else if (isImageFile(entry.name)) {
      descriptors.push({ kind: 'zipEntry', zip, name: entry.name })
    }
  }
  return { descriptors, tempDirs }
}

// ─── 通用"文件型"描述符构建：文件夹 / 单图 / ZIP / TAR / 7z / RAR ───
async function buildFileDescriptors(sourcePath: string): Promise<{ descriptors: PageDescriptor[]; tempDirs: string[] }> {
  let stat: fs.Stats
  try { stat = fs.statSync(sourcePath) } catch { return { descriptors: [], tempDirs: [] } }

  if (stat.isDirectory()) {
    const out = { descriptors: [] as PageDescriptor[], tempDirs: [] as string[] }
    await listFolderDescriptors(sourcePath, '', out)
    out.descriptors.sort((a, b) => compareNatural(fullSortKey(a.name), fullSortKey(b.name)))
    return { descriptors: out.descriptors, tempDirs: out.tempDirs }
  }

  const ext = path.extname(sourcePath).toLowerCase()
  const kind = ARCHIVE_EXTS[ext]

  if (!kind) {
    if (isImageFile(sourcePath)) {
      return { descriptors: [{ kind: 'file', path: sourcePath, name: path.basename(sourcePath) }], tempDirs: [] }
    }
    return { descriptors: [], tempDirs: [] }
  }

  if (kind === 'zip') {
    return buildZipDescriptors(sourcePath)
  }

  // tar / 7z / rar：解压到临时目录后按文件夹列出（嵌套压缩包在 listFolderDescriptors 中递归展开）
  if (kind === 'tar' || kind === '7z' || kind === 'rar') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easycomic-'))
    try {
      if (kind === 'tar') {
        await new Promise<void>((resolve, reject) => {
          const extract = tar.extract()
          extract.on('entry', (header, stream, next) => {
            // 必须消费每个 entry 的数据流，否则 tar-stream 会因背压永远卡住。
            const outPath = path.join(tmpDir, header.name)
            try {
              fs.mkdirSync(path.dirname(outPath), { recursive: true })
            } catch { /* noop */ }
            const write = fs.createWriteStream(outPath)
            stream.on('error', (err: any) => {
              write.destroy()
              reject(new Error(`TAR 条目 "${header.name}" 读取失败: ${err?.message ?? err}`))
            })
            write.on('error', (err: any) => {
              reject(new Error(`TAR 条目 "${header.name}" 写入失败: ${err?.message ?? err}`))
            })
            write.on('finish', () => next())
            stream.pipe(write)
          })
          extract.on('finish', () => resolve())
          extract.on('error', reject)
          fs.createReadStream(sourcePath).pipe(extract)
        })
      } else {
        await new Promise<void>((resolve, reject) => {
          unpack7z(sourcePath, tmpDir, (err) =>
            err ? reject(new Error(`解压失败: ${err.message || String(err)}`)) : resolve()
          )
        })
      }
      const sub = await buildFileDescriptors(tmpDir)
      return { descriptors: sub.descriptors, tempDirs: [tmpDir, ...sub.tempDirs] }
    } catch (err) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
      throw err
    }
  }

  return { descriptors: [], tempDirs: [] }
}

// ─── EPUB：按 OPF spine 顺序建立 zipEntry 描述符 ───
async function buildEpubDescriptors(filePath: string): Promise<{ descriptors: PageDescriptor[]; tempDirs: string[] }> {
  const data = fs.readFileSync(filePath)
  if (data.length === 0) throw new Error('EPUB 文件为空')
  const zip = await JSZip.loadAsync(data)
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('EPUB 缺少 META-INF/container.xml')
  const containerXml = await containerFile.async('string')
  const opfPath = extractOpfPath(containerXml)
  if (!opfPath) throw new Error('EPUB container.xml 中未找到 OPF 路径')
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error(`EPUB 中未找到 OPF 文件: ${opfPath}`)
  const opfXml = await opfFile.async('string')
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : ''
  const manifest = parseManifest(opfXml)
  const spine = parseSpine(opfXml)
  if (spine.length === 0) throw new Error('EPUB OPF 中未找到 spine 条目')

  const descriptors: PageDescriptor[] = []
  const usedPaths = new Set<string>()
  for (const idref of spine) {
    const item = manifest.get(idref)
    if (!item) continue
    const fullPath = resolveZipPath(opfDir, item.href)
    if (usedPaths.has(fullPath)) continue
    usedPaths.add(fullPath)
    const isImage = item.mediaType.startsWith('image/')
    const isXhtml = item.mediaType.includes('xhtml') || item.mediaType.includes('html') || item.mediaType.includes('xml')
    if (isImage) {
      if (zip.file(fullPath)) descriptors.push({ kind: 'zipEntry', zip, name: fullPath })
    } else if (isXhtml) {
      const xhtmlFile = zip.file(fullPath)
      if (!xhtmlFile) continue
      try {
        const xhtmlContent = await xhtmlFile.async('string')
        const xhtmlDir = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : ''
        const imgSrcs = extractImageSrcs(xhtmlContent)
        for (const src of imgSrcs) {
          const imgPath = resolveZipPath(xhtmlDir, src)
          if (usedPaths.has(imgPath)) continue
          usedPaths.add(imgPath)
          if (zip.file(imgPath)) descriptors.push({ kind: 'zipEntry', zip, name: imgPath })
        }
      } catch (err: any) {
        console.warn(`[EasyComic] EPUB XHTML parse failed: ${fullPath}: ${err}`)
      }
    }
  }
  if (descriptors.length === 0) {
    // 降级：spine 无图片 → 退回 ZIP 全部图片
    const all = Object.values(zip.files).filter(e => !e.dir && isImageFile(e.name))
    all.sort((a, b) => compareNatural(fullSortKey(a.name), fullSortKey(b.name)))
    for (const e of all) descriptors.push({ kind: 'zipEntry', zip, name: e.name })
  }
  return { descriptors, tempDirs: [] }
}

// ─── FB2：解析 <binary> 块为描述符 ───
function buildFb2Descriptors(filePath: string): { descriptors: PageDescriptor[]; tempDirs: string[] } {
  const content = fs.readFileSync(filePath, 'utf-8')
  const descriptors: PageDescriptor[] = []
  const regex = /<binary[^>]*content-type=["']image\/(\w+)["'][^>]*>([\s\S]*?)<\/binary>/gi
  let match: RegExpExecArray | null
  let idx = 0
  while ((match = regex.exec(content)) !== null) {
    const ext = match[1].toLowerCase()
    const b64 = match[2].replace(/\s/g, '')
    descriptors.push({ kind: 'fb2', ext, b64, name: `image-${idx + 1}.${ext}` })
    idx++
  }
  if (descriptors.length === 0) {
    descriptors.push({ kind: 'fb2', ext: 'png', b64: '', name: 'no-images.png' })
  }
  return { descriptors, tempDirs: [] }
}

// ─── 内部：建立/缓存 OpenedComic（不取首图）───
async function openComicInternal(sourcePath: string): Promise<OpenedComic> {
  const existing = sourceCache.get(sourcePath)
  if (existing) { existing.lastUsed = Date.now(); return existing }

  let stat: fs.Stats
  try { stat = fs.statSync(sourcePath) } catch (err: any) { throw new Error(`无法访问文件: ${err?.message ?? err}`) }

  const isFolder = stat.isDirectory()
  const ext = path.extname(sourcePath).toLowerCase()
  // 文件漫画标题去掉扩展名，文件夹漫画标题保留文件夹名
  const title = isFolder ? path.basename(sourcePath) : path.basename(sourcePath, ext)
  const kind = ARCHIVE_EXTS[ext]

  let descriptors: PageDescriptor[] = []
  let tempDirs: string[] = []

  if (isFolder) {
    const r = await buildFileDescriptors(sourcePath); descriptors = r.descriptors; tempDirs = r.tempDirs
  } else if (!kind) {
    if (isImageFile(sourcePath)) { descriptors = [{ kind: 'file', path: sourcePath, name: path.basename(sourcePath) }]; tempDirs = [] }
    else throw new Error(`不支持的文件格式: ${ext || '未知'}`)
  } else if (kind === 'pdf') {
    if (!pdfRenderer) throw new Error('PDF 渲染器未初始化：主进程尚未创建隐藏渲染窗口。')
    const { pageCount } = await pdfRenderer.openPdf(sourcePath)
    descriptors = Array.from({ length: pageCount }, (_, i) => ({ kind: 'pdf' as const, name: `page-${i + 1}` }))
    tempDirs = []
  } else if (kind === 'fb2') {
    const r = buildFb2Descriptors(sourcePath); descriptors = r.descriptors; tempDirs = r.tempDirs
  } else if (kind === 'epub') {
    const r = await buildEpubDescriptors(sourcePath); descriptors = r.descriptors; tempDirs = r.tempDirs
  } else {
    // zip / tar / 7z / rar
    const r = await buildFileDescriptors(sourcePath); descriptors = r.descriptors; tempDirs = r.tempDirs
  }

  if (descriptors.length === 0) throw new Error('未找到可识别的图片页')

  const fileType = inferFileType(sourcePath, isFolder, descriptors)
  const opened: OpenedComic = { source: sourcePath, title, isFolder, descriptors, tempDirs, fileType, lastUsed: Date.now() }
  sourceCache.set(sourcePath, opened)
  evictCache()
  return opened
}

// ─── 公开：打开漫画（返回结构 + 首图）───
export async function openComic(sourcePath: string): Promise<OpenComicResult> {
  const opened = await openComicInternal(sourcePath)
  const firstPage = await getPage(sourcePath, 0)
  return {
    title: opened.title,
    source: opened.source,
    pageCount: opened.descriptors.length,
    firstPage,
    isFolder: opened.isFolder,
    fileType: opened.fileType
  }
}

// ─── 公开：按需取单页（懒加载核心）───
export async function getPage(sourcePath: string, index: number): Promise<ComicPage | null> {
  let opened = sourceCache.get(sourcePath)
  if (!opened) opened = await openComicInternal(sourcePath)
  if (!opened || index < 0 || index >= opened.descriptors.length) return null
  const d = opened.descriptors[index]
  try {
    if (d.kind === 'file') {
      const buf = fs.readFileSync(d.path)
      return { index, name: path.basename(d.path), dataUrl: toBase64(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), mimeFromExt(path.extname(d.path))) }
    }
    if (d.kind === 'zipEntry') {
      const entry = d.zip?.file(d.name)
      if (!entry) return makePlaceholderPage(index, d.name)
      const buf = await entry.async('uint8array')
      return { index, name: d.name, dataUrl: toBase64(buf, mimeFromExt(path.extname(d.name))) }
    }
    if (d.kind === 'pdf') {
      if (!pdfRenderer) throw new Error('PDF 渲染器未初始化')
      return await pdfRenderer.renderPdfPage(sourcePath, index)
    }
    if (d.kind === 'fb2') {
      if (!d.b64) return makePlaceholderPage(index, d.name)
      const mime = mimeFromExt('.' + d.ext)
      return { index, name: d.name, dataUrl: `data:${mime};base64,${d.b64}` }
    }
  } catch (err: any) {
    console.warn(`[EasyComic] getPage("${sourcePath}", ${index}) failed: ${err?.message ?? err}`)
    return makePlaceholderPage(index, `page-${index + 1}`)
  }
  return null
}

// ═══════════════════════════════════════════
// 读取单张图片为 dataUrl（供封面更换使用）
// ═══════════════════════════════════════════
export function readImageAsDataUrl(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mime = mimeFromExt(ext)
  return toBase64(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), mime)
}

// ═══════════════════════════════════════════
// 扫描文件夹内所有支持的漫画文件
// ═══════════════════════════════════════════

export interface ScannedComicFile {
  path: string
  title: string
}

export function scanFolder(folderPath: string): ScannedComicFile[] {
  const results: ScannedComicFile[] = []

  const inspectFolder = (dir: string): 'images' | 'mixed' | 'empty' => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch { return 'empty' }
    if (entries.length === 0) return 'empty'
    let hasImage = false
    for (const e of entries) {
      if (isIgnoredEntry(e.name)) continue
      if (e.isDirectory()) {
        console.log(`[EasyComic:scanFolder] "${dir}" has subdirectory "${e.name}" → mixed`)
        return 'mixed'
      }
      if (e.isFile() && isImageFile(e.name)) {
        hasImage = true
      }
    }
    return hasImage ? 'images' : 'empty'
  }

  console.log(`[EasyComic:scanFolder] Scanning "${folderPath}"`)

  if (inspectFolder(folderPath) === 'images') {
    console.log(`[EasyComic:scanFolder] Root folder is pure images → 1 comic`)
    results.push({ path: folderPath, title: path.basename(folderPath) })
  } else {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(folderPath, { withFileTypes: true })
    } catch { return results }

    console.log(`[EasyComic:scanFolder] Root is container, checking ${entries.length} entries...`)

    for (const e of entries) {
      if (isIgnoredEntry(e.name + '/')) {
        console.log(`[EasyComic:scanFolder] Skipping ignored entry "${e.name}"`)
        continue
      }

      if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (ARCHIVE_EXTS[ext]) {
          console.log(`[EasyComic:scanFolder] Adding archive/doc "${e.name}" (${ext})`)
          results.push({ path: path.join(folderPath, e.name), title: path.basename(e.name, ext) })
        } else if (isImageFile(e.name)) {
          console.log(`[EasyComic:scanFolder] Adding single image "${e.name}" (${ext})`)
          results.push({ path: path.join(folderPath, e.name), title: path.basename(e.name, ext) })
        }
      } else if (e.isDirectory()) {
        const full = path.join(folderPath, e.name)
        const state = inspectFolder(full)
        if (state === 'images') {
          console.log(`[EasyComic:scanFolder] Adding subfolder "${e.name}" as comic (pure images)`)
          results.push({ path: full, title: e.name })
        } else {
          console.log(`[EasyComic:scanFolder] Skipping subfolder "${e.name}" (state=${state})`)
        }
      }
    }
  }

  results.sort((a, b) => a.title.localeCompare(b.title, 'zh'))

  console.log(`[EasyComic:scanFolder] "${folderPath}" → ${results.length} 部漫画:`)
  results.forEach(r => console.log(`  - ${r.title}: ${r.path}`))

  return results
}
