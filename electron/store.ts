import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════
// EasyComic 持久化存储
// 所有用户数据保存到 Electron 的 userData 目录下的独立 JSON 文件
// 位置默认：
//   Windows: %APPDATA%/EasyComic/user-data/
// 好处：覆盖安装 / 版本升级时不会丢失用户数据
// ═══════════════════════════════════════════

/** 存储目录名（放在 userData 下） */
const STORE_DIRNAME = 'user-data'

/** 存储键 => 文件名映射（每个键一个 JSON 文件，便于单独备份/迁移） */
const FILE_MAP: Record<string, string> = {
  'easycomic:comics': 'comics.json',
  'easycomic:progress': 'reading-progress.json',
  'easycomic:removed-sources': 'removed-sources.json',
  'easycomic:reader-settings': 'reader-settings.json',
  'easycomic:sidebar-order': 'sidebar-order.json',
  'easycomic:sort-type': 'sort-type.json',
  'easycomic:dismissed': 'dismissed-dialogs.json'
}

function getStoreDir(): string {
  const dir = path.join(app.getPath('userData'), STORE_DIRNAME)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function resolveFile(key: string): string {
  const filename = FILE_MAP[key] ?? `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  return path.join(getStoreDir(), filename)
}

/** 读取一个存储键，返回 null 表示不存在 */
export function readStore<T = unknown>(key: string): T | null {
  try {
    const file = resolveFile(key)
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf-8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as T
  } catch (err: any) {
    console.error(`[EasyComic:store] read "${key}" failed:`, err?.message ?? err)
    return null
  }
}

/** 写入一个存储键（直接整文件替换写入 + 备份/原子性保障） */
export function writeStore<T>(key: string, value: T): boolean {
  try {
    const file = resolveFile(key)
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    const data = JSON.stringify(value, null, 2)
    fs.writeFileSync(tmp, data, 'utf-8')
    // 原子替换：在 Windows 下若旧文件存在先删除
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch { /* ignore */ }
    fs.renameSync(tmp, file)
    return true
  } catch (err: any) {
    console.error(`[EasyComic:store] write "${key}" failed:`, err?.message ?? err)
    return false
  }
}

/** 删除一个存储键对应的文件 */
export function deleteStore(key: string): boolean {
  try {
    const file = resolveFile(key)
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
    return true
  } catch (err: any) {
    console.error(`[EasyComic:store] delete "${key}" failed:`, err?.message ?? err)
    return false
  }
}

/** 列出当前所有存储文件（调试用） */
export function listStoreKeys(): string[] {
  const dir = getStoreDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
}

/** 删除所有存储文件（清空用户数据） */
export function deleteAllStore(): boolean {
  try {
    const dir = getStoreDir()
    if (!fs.existsSync(dir)) return true
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      fs.unlinkSync(path.join(dir, file))
    }
    // 同时清理封面缩略图缓存目录（covers/），避免遗留大文件
    const coversDir = path.join(dir, 'covers')
    if (fs.existsSync(coversDir)) {
      fs.rmSync(coversDir, { recursive: true, force: true })
    }
    console.log(`[EasyComic:store] deleted all ${files.length} store files (+covers)`)
    return true
  } catch (err: any) {
    console.error(`[EasyComic:store] deleteAll failed:`, err?.message ?? err)
    return false
  }
}
