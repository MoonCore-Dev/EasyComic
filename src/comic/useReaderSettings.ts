import { useEffect, useCallback, useMemo } from 'react'
import type { PersistedApi } from './usePersisted'
import { usePersisted } from './usePersisted'

// ─── 阅读器设置类型 ───
export type ReadingMode = 'single' | 'double' | 'stitch'
export type TurnAnimation = 'flip' | 'slide' | 'none'
export type PageOrder = 'normal' | 'japanese'
export type PageFill = 'contain' | 'cover'

export interface ReaderSettings {
  /** 阅读模式：单页 / 双页 / 滚动 */
  mode: ReadingMode
  /** 翻页动效：仿真翻书 / 滑入 / 无 */
  animation: TurnAnimation
  /** 页面顺序：普通（左翻） / 日式（右翻） */
  pageOrder: PageOrder
  /** 页面填充：适应（可能有黑边）/ 填充（占满，可能裁剪） */
  pageFill: PageFill
  /** 单/双页模式缩放比例（0.25~1.0 上限100%） */
  zoomPage: number
  /** 滚动(拼接)模式缩放比例（0.25~4） */
  zoomStitch: number
  /** 沉浸模式下是否显示右下角小页码 */
  showPageNumber: boolean
  /** 滚动(拼接)模式下是否隐藏滚动条 */
  hideScrollbar: boolean
}

const SETTINGS_KEY = 'easycomic:reader-settings'

const defaultSettings: ReaderSettings = {
  mode: 'single',
  animation: 'slide',
  pageOrder: 'normal',
  pageFill: 'contain',
  zoomPage: 1,
  zoomStitch: 1,
  showPageNumber: true,
  hideScrollbar: false
}

function migrateFromLegacy(raw: ReaderSettings): ReaderSettings {
  // 迁移：旧版统一字段 zoom 拆成 zoomPage / zoomStitch
  const p = raw as any
  if (p.zoom != null && (p.zoomPage == null || p.zoomStitch == null)) {
    return {
      ...raw,
      zoomPage: p.zoomPage ?? Math.min(1, (Number(p.zoom) || 1)),
      zoomStitch: p.zoomStitch ?? (Number(p.zoom) || 1)
    }
  }
  return raw
}

function clampZoom(mode: ReadingMode, value: number): number {
  const max = mode === 'stitch' ? 4 : 1
  const clamped = Math.max(0.25, Math.min(max, value))
  // 按 1% 步长对齐（2 位小数），让每次调节都落到整数百分比上
  return Math.round(clamped * 100) / 100
}

/** 合并默认值 + 迁移 */
function normalize(raw: ReaderSettings | null): ReaderSettings {
  if (!raw) return defaultSettings
  return { ...defaultSettings, ...migrateFromLegacy(raw) }
}

export type ReaderUpdateFn = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void

/** 阅读器设置 hook —— 所有变更走 Electron userData 独立 JSON 文件（升级安装保留） */
export function useReaderSettings(): {
  settings: ReaderSettings
  update: ReaderUpdateFn
  setSettings: PersistedApi<ReaderSettings>['setValue']
  currentZoom: number
  adjustZoom: (delta: number) => void
  resetZoom: () => void
  cycle: <K extends keyof ReaderSettings>(key: K, options: ReaderSettings[K][]) => void
} {
  const { value, setValue, initialized } = usePersisted<ReaderSettings>(SETTINGS_KEY, defaultSettings)
  // 首次从 IPC 读到值后再走一次 normalize，保证迁移生效
  useEffect(() => {
    if (initialized) {
      const norm = normalize(value)
      if (JSON.stringify(norm) !== JSON.stringify(value)) {
        setValue(norm)
      }
    }
  }, [initialized, value, setValue])

  const settings = normalize(value)

  /** 按当前模式取对应 zoom 值 */
  const currentZoom = settings.mode === 'stitch' ? settings.zoomStitch : settings.zoomPage

  const update = useCallback(<K extends keyof ReaderSettings>(key: K, valueArg: ReaderSettings[K]) => {
    setValue(prev => {
      const next = { ...normalize(prev), [key]: valueArg } as ReaderSettings
      return next
    })
  }, [setValue])

  /** 调整当前模式的缩放（按模式自动裁剪到合法范围） */
  const adjustZoom = useCallback((delta: number) => {
    setValue(prevRaw => {
      const prev = normalize(prevRaw)
      if (prev.mode === 'stitch') {
        return { ...prev, zoomStitch: clampZoom('stitch', prev.zoomStitch + delta) }
      }
      return { ...prev, zoomPage: clampZoom(prev.mode, prev.zoomPage + delta) }
    })
  }, [setValue])

  /** 将当前模式的缩放重置为 1 */
  const resetZoom = useCallback(() => {
    setValue(prevRaw => {
      const prev = normalize(prevRaw)
      return prev.mode === 'stitch'
        ? { ...prev, zoomStitch: 1 }
        : { ...prev, zoomPage: 1 }
    })
  }, [setValue])

  /** 循环切换某枚举型设置项 */
  const cycle = useCallback(<K extends keyof ReaderSettings>(
    key: K,
    options: ReaderSettings[K][]
  ) => {
    setValue(prevRaw => {
      const prev = normalize(prevRaw)
      const current = prev[key] as ReaderSettings[K]
      const idx = options.indexOf(current)
      const next = options[(idx + 1) % options.length]
      return { ...prev, [key]: next }
    })
  }, [setValue])

  return useMemo(
    () => ({ settings, update, setSettings: setValue, currentZoom, adjustZoom, resetZoom, cycle }),
    [settings, update, setValue, currentZoom, adjustZoom, resetZoom, cycle]
  )
}
