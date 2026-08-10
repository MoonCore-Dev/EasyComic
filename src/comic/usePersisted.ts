import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

/**
 * 全局内存缓存：避免每次 useEffect 读都走 IPC / localStorage。
 * 同一 key 在多个组件中共享，任意组件写入后其他组件立即拿到最新值。
 */
const memoryCache = new Map<string, unknown>()
/** 首屏加速：preload 同步预读的 store 数据（window.__EASYCOMIC_BOOTSTRAP__）。
 *  模块加载时即灌入内存缓存，使 usePersisted 的 initialized 在首帧即为 true，
 *  书库 / 设置不再出现“加载中”闪烁，实现点开即用。 */
const bootstrapDone =
  typeof window !== 'undefined' && (window as any).__EASYCOMIC_BOOTSTRAP__ !== undefined

function seedBootstrap() {
  try {
    const b = (window as any).__EASYCOMIC_BOOTSTRAP__
    if (b && typeof b === 'object') {
      for (const [k, v] of Object.entries(b)) {
        if (!memoryCache.has(k)) memoryCache.set(k, v)
      }
    }
  } catch {
    /* ignore */
  }
}
seedBootstrap()
/** 等待 IPC 首次读取完成的 Promise，避免重复发起 */
const initPromises = new Map<string, Promise<void>>()
/** 内存中的待写入队列：批量 + 节流，避免高频 set 时短时间内大量 IPC 调用 */
const pendingWrite = new Map<string, unknown>()
let writeTimer: number | null = null
const WRITE_DEBOUNCE_MS = 120
/** 清空版本号：每次 clearAllPersisted 递增，驱动 usePersisted 的 useEffect 重新初始化 */
let clearVersion = 0

function isElectron() {
  return typeof window !== 'undefined' && !!(window as any).electronAPI?.store
}

/**
 * 合并读：先读内存缓存 -> 再尝试 Electron store -> 最后降级 localStorage
 */
async function readKey<T = unknown>(key: string): Promise<T | null> {
  if (memoryCache.has(key)) return memoryCache.get(key) as T | null
  if (isElectron()) {
    const v = await (window as any).electronAPI.store.read(key) as T | null
    // 读取成功后：同步迁移旧 localStorage 数据（仅一次）
    if (v == null) {
      const fromLS = tryLSGet(key)
      if (fromLS != null) {
        memoryCache.set(key, fromLS)
        // 异步写回 Electron store（不阻塞读取）
        ;(window as any).electronAPI.store.write(key, fromLS).catch(() => {})
        return fromLS as T
      }
    }
    if (v != null) memoryCache.set(key, v)
    return v
  }
  const v = tryLSGet(key)
  if (v != null) memoryCache.set(key, v)
  return v as T | null
}

/** 批量写：120ms 内多次 write 合并为一次 IPC 调用 */
function scheduleWrite(key: string, value: unknown) {
  pendingWrite.set(key, value)
  if (writeTimer != null) return
  writeTimer = window.setTimeout(async () => {
    writeTimer = null
    const queue = Array.from(pendingWrite.entries())
    pendingWrite.clear()
    if (isElectron()) {
      for (const [k, v] of queue) {
        try { await (window as any).electronAPI.store.write(k, v) } catch { /* ignore */ }
      }
    } else {
      for (const [k, v] of queue) { tryLSSet(k, v) }
    }
  }, WRITE_DEBOUNCE_MS)
}

function tryLSGet(key: string): unknown | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null || raw.trim() === '') return null
    return JSON.parse(raw)
  } catch { return null }
}
function tryLSSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

/**
 * 跨组件订阅：当 key 的内存缓存更新时，所有使用该 key 的订阅者都能重渲染。
 * 通过自增版本号通知订阅者。
 */
type Listener = () => void
const listeners = new Map<string, Set<Listener>>()
function emit(key: string) {
  listeners.get(key)?.forEach(l => l())
}

export interface PersistedApi<T> {
  value: T
  setValue: (next: T | ((prev: T) => T)) => void
  /** 立即将缓存写回持久层（默认有 120ms 节流） */
  flush: () => void
  /** 是否完成了从磁盘首次读取的初始化 */
  initialized: boolean
}

/**
 * 清空所有持久化缓存（内存 + 待写队列 + 初始化承诺）
 * 用于"删除所有用户数据"场景，防止旧数据被重新写回
 */
export function clearAllPersisted(): void {
  // 1. 丢弃所有待写入（不写回磁盘）
  pendingWrite.clear()
  if (writeTimer != null) {
    window.clearTimeout(writeTimer)
    writeTimer = null
  }
  // 2. 清空内存缓存
  memoryCache.clear()
  // 3. 清空初始化承诺（下次读取会强制从磁盘重读）
  initPromises.clear()
  // 4. 递增版本号，驱动 usePersisted 的 useEffect 重新执行
  clearVersion++
  // 5. 通知所有订阅者重渲染
  for (const key of Array.from(listeners.keys())) {
    emit(key)
  }
}

/** 获取当前清空版本号（供 usePersisted 的 useEffect 依赖检测） */
export function getClearVersion(): number {
  return clearVersion
}

/**
 * 持久化 hook：Electron 下用 user-data 目录独立 JSON 文件（升级安装不丢失）
 * 浏览器 / dev-server 预览降级到 localStorage。
 * - 同 key 跨组件内存共享
 * - 写入自带 120ms 节流，避免渲染循环反复写 IPC
 */
export function usePersisted<T>(key: string, defaultValue: T): PersistedApi<T> {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const initializedRef = useRef(false)
  // 记录上一次看到的 clearVersion，用于检测清空操作
  const lastClearVerRef = useRef(getClearVersion())
  // 稳定默认值：防止调用方每次渲染传入新的数组/对象字面量，导致 setValue 引用变化，
  // 进而触发依赖 setValue 的 useEffect 死循环。
  const stableDefault = useMemo(() => defaultValue, [])
  const defaultValueRef = useRef(stableDefault)
  defaultValueRef.current = stableDefault
  // 用一个缓存 ref，避免 key 变化 / 首次读取前返回 undefined
  const getCachedOrDefault = (): T => {
    if (memoryCache.has(key)) return memoryCache.get(key) as T
    return defaultValueRef.current
  }
  const [initialized, setInitialized] = useState(() => memoryCache.has(key) || bootstrapDone)

  // 订阅跨组件更新
  useEffect(() => {
    let set = listeners.get(key)
    if (!set) { set = new Set(); listeners.set(key, set) }
    set.add(forceUpdate)
    return () => {
      set!.delete(forceUpdate)
      if (set!.size === 0) listeners.delete(key)
    }
  }, [key, forceUpdate])

  // 初始化：保证同一 key 全局只会触发一次 IPC 读取
  // 依赖 clearVersion：清空后强制重新从磁盘读取
  const currClearVer = getClearVersion()
  useEffect(() => {
    // 检测到 clearVersion 变化 → 重置初始化状态，强制重新读取
    if (lastClearVerRef.current !== currClearVer) {
      lastClearVerRef.current = currClearVer
      setInitialized(false)
      initializedRef.current = false
    }

    let canceled = false
    if (memoryCache.has(key) || bootstrapDone) {
      setInitialized(true)
      initializedRef.current = true
      return
    }
    let p = initPromises.get(key)
    if (!p) {
      p = (async () => { await readKey(key) })() as Promise<void>
      initPromises.set(key, p)
    }
    p.then(() => {
      if (canceled) return
      setInitialized(true)
      initializedRef.current = true
      forceUpdate()
    })
    return () => { canceled = true }
  }, [key, forceUpdate, currClearVer])

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    const prev = memoryCache.has(key) ? (memoryCache.get(key) as T) : defaultValueRef.current
    const finalVal = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
    memoryCache.set(key, finalVal)
    scheduleWrite(key, finalVal)
    emit(key) // 通知所有订阅此 key 的组件重渲染
  }, [key])

  const flush = useCallback(() => {
    if (writeTimer != null) {
      window.clearTimeout(writeTimer); writeTimer = null
      const queue = Array.from(pendingWrite.entries())
      pendingWrite.clear()
      // 同步触发（不等待）
      void (async () => {
        if (isElectron()) {
          for (const [k, v] of queue) {
            try { await (window as any).electronAPI.store.write(k, v) } catch { /* ignore */ }
          }
        } else {
          for (const [k, v] of queue) { tryLSSet(k, v) }
        }
      })()
    }
  }, [])

  return { value: getCachedOrDefault(), setValue, flush, initialized }
}

/** 立即把内存中的待写入队列全部刷到磁盘（用于关闭应用/退出阅读器前保存进度） */
export function flushPendingWrites(): void {
  if (writeTimer != null) {
    window.clearTimeout(writeTimer)
    writeTimer = null
  }
  const queue = Array.from(pendingWrite.entries())
  pendingWrite.clear()
  if (queue.length === 0) return
  void (async () => {
    if (isElectron()) {
      for (const [k, v] of queue) {
        try { await (window as any).electronAPI.store.write(k, v) } catch { /* ignore */ }
      }
    } else {
      for (const [k, v] of queue) { tryLSSet(k, v) }
    }
  })()
}
