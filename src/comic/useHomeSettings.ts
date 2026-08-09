import { useCallback } from 'react'
import { usePersisted } from './usePersisted'

/** 主页（书库）设置类型 */
export interface HomeSettings {
  /** 是否在书库卡片上显示文件类型标签 */
  showFileType: boolean
  /** 是否始终显示阅读器诊断面板 */
  alwaysShowDebugPanel: boolean
  /** 是否启用主页虚化漫画封面背景 */
  backdropBlurEnabled: boolean
}

const SETTINGS_KEY = 'easycomic:home-settings'

const defaultSettings: HomeSettings = {
  showFileType: true,
  alwaysShowDebugPanel: false,
  backdropBlurEnabled: true
}

export function useHomeSettings() {
  const { value: settings, setValue: setRaw } = usePersisted<HomeSettings>(SETTINGS_KEY, defaultSettings)

  const update = useCallback(<K extends keyof HomeSettings>(key: K, value: HomeSettings[K]) => {
    setRaw({ ...settings, [key]: value })
  }, [settings, setRaw])

  return {
    settings: settings ?? defaultSettings,
    update
  }
}
