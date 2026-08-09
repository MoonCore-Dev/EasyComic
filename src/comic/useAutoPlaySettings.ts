import { useCallback } from 'react'
import { usePersisted } from './usePersisted'

export interface AutoPlaySettings {
  /** 单/双页模式下的自动翻页间隔（毫秒） */
  pageFlipIntervalMs: number
  /** 滚动模式下的自动滚动速度（像素/秒） */
  scrollSpeedPxPerSecond: number
}

const SETTINGS_KEY = 'easycomic:autoplay-settings'

const defaultSettings: AutoPlaySettings = {
  pageFlipIntervalMs: 3000,
  scrollSpeedPxPerSecond: 150
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/** 自动连播设置 hook —— 与阅读器主设置隔离，独立持久化到用户数据 */
export function useAutoPlaySettings() {
  const { value, setValue } = usePersisted<AutoPlaySettings>(SETTINGS_KEY, defaultSettings)
  const settings = value ?? defaultSettings

  const update = useCallback(<K extends keyof AutoPlaySettings>(key: K, next: AutoPlaySettings[K]) => {
    setValue({ ...settings, [key]: next } as AutoPlaySettings)
  }, [settings, setValue])

  const setPageFlipIntervalMs = useCallback((raw: number) => {
    update('pageFlipIntervalMs', clamp(Math.round(raw), 500, 30000))
  }, [update])

  const setScrollSpeedPxPerSecond = useCallback((raw: number) => {
    update('scrollSpeedPxPerSecond', clamp(Math.round(raw), 10, 2000))
  }, [update])

  return {
    settings,
    defaultSettings,
    update,
    setPageFlipIntervalMs,
    setScrollSpeedPxPerSecond
  }
}
