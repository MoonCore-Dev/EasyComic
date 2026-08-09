import { useEffect, useState } from 'react'
import type { Comic } from '../types/comic'

const coverCache = new Map<string, string>()
const MAX_COVER_CACHE = 200

function readCoverCache(id: string): string | undefined {
  const hit = coverCache.get(id)
  if (hit !== undefined) {
    coverCache.delete(id)
    coverCache.set(id, hit)
  }
  return hit
}

function writeCoverCache(id: string, dataUrl: string) {
  if (coverCache.has(id)) coverCache.delete(id)
  coverCache.set(id, dataUrl)
  while (coverCache.size > MAX_COVER_CACHE) {
    const first = coverCache.keys().next().value
    if (first !== undefined) coverCache.delete(first)
  }
}

async function makeThumb(dataUrl: string, maxSize = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 canvas 上下文'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('缩略图解码失败'))
    img.src = dataUrl
  })
}

/**
 * 把漫画封面解析为可直接用于 <img src> 或 backgroundImage 的 URL。
 * 解析逻辑与 CoverResolver 保持一致：优先磁盘缓存 → coverDataUrl → 源文件自愈。
 */
export function useCoverUrl(comic: Comic | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(
    comic ? (comic.coverDataUrl ?? readCoverCache(comic.id) ?? null) : null
  )

  useEffect(() => {
    if (!comic) {
      setSrc(null)
      return
    }
    let cancelled = false

    setSrc(comic.coverDataUrl ?? readCoverCache(comic.id) ?? null)

    const resolve = async () => {
      const api = (window as any).electronAPI?.comic
      if (comic.coverPath && api?.getCover) {
        try {
          const dataUrl = await api.getCover(comic.coverPath)
          if (!cancelled && dataUrl) {
            writeCoverCache(comic.id, dataUrl)
            setSrc(dataUrl)
            return
          }
        } catch {
          // 读取失败 → 继续兜底
        }
      }
      if (!cancelled && comic.coverDataUrl) {
        writeCoverCache(comic.id, comic.coverDataUrl)
        setSrc(comic.coverDataUrl)
        return
      }
      if (!cancelled && comic.sourcePath && api?.load) {
        try {
          const result = await api.load(comic.sourcePath)
          const first = result?.firstPage?.dataUrl
          if (!cancelled && first) {
            writeCoverCache(comic.id, first)
            setSrc(first)
            try {
              const thumb = await makeThumb(first)
              const cp = await api.saveCover({ id: comic.id, dataUrl: thumb })
              if (cp && !cancelled) {
                const d = await api.getCover(cp)
                if (d) {
                  writeCoverCache(comic.id, d)
                  setSrc(d)
                }
              }
            } catch (e) {
              console.warn('[EasyComic] 背景封面缩略图生成失败（已用原图兜底）:', (e as Error)?.message ?? e)
            }
          }
        } catch (e) {
          console.warn('[EasyComic] 背景封面加载源失败:', (e as Error)?.message ?? e)
        }
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [comic?.id, comic?.coverPath, comic?.coverDataUrl, comic?.sourcePath])

  return src
}
