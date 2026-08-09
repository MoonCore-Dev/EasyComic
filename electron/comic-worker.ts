import { parentPort, workerData } from 'worker_threads'

// 懒加载架构下，漫画的"打开（openComic）"与"逐页渲染（getPage）"均在主进程完成
// （见 comic-loader.ts），此 Worker 不再被使用，保留仅为兼容构建入口。
void parentPort
void workerData
