# EasyComic 项目交接文档

## 1. 项目概述

### 项目名称
EasyComic

### 一句话描述
一款轻量化沉浸式本地漫画阅读器，支持多种漫画格式，提供流畅的阅读体验。

### 核心定位
- **轻量化**：低资源占用，快速启动
- **沉浸式**：全屏阅读模式，隐藏所有 UI 干扰
- **本地化**：纯本地运行，无需联网，保护隐私

### 技术栈
| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Electron | 31.3.1 |
| 前端 | React | 18.3.1 |
| 语言 | TypeScript | 5.5.3 |
| 构建 | Vite | 5.3.4 |
| 打包 | electron-builder | 24.13.3 |
| 样式 | 原生 CSS（非 Tailwind） | - |

### 主要依赖库
| 库 | 用途 |
|----|------|
| `jszip` | ZIP/CBZ 压缩包解压 |
| `7zip-min` | 7Z/CB7 压缩包解压 |
| `tar-stream` | TAR/CBT 压缩包解压 |
| `pdfjs-dist` | PDF 解析与渲染（v4.10.38 CJS 版本） |

---

## 2. 目录结构与说明

```
Easy Comic/
├── electron/                    # Electron 主进程代码
│   ├── main.ts                  # 主进程入口：窗口管理、IPC 路由
│   ├── preload.ts               # 预加载脚本：暴露 API 给渲染进程
│   ├── comic-loader.ts          # 核心加载器：解析所有漫画格式
│   ├── comic-worker.ts          # Worker 线程：异步解压/解析压缩包
│   └── store.ts                 # 数据持久化：读写 userData 下的 JSON 文件
│
├── src/                         # 渲染进程代码
│   ├── App.tsx                  # 应用主入口：视图路由、状态管理
│   ├── App.css                  # 应用全局样式
│   ├── index.css                # CSS 变量与全局重置
│   ├── main.tsx                 # React 入口
│   │
│   ├── types/
│   │   └── comic.ts             # 类型定义：Comic、LoadedComic、ViewType
│   │
│   ├── comic/                   # 业务逻辑 Hook
│   │   ├── useComicLibrary.ts   # 书库管理：导入、删除、进度追踪
│   │   ├── useReaderSettings.ts # 阅读器设置：模式、缩放、动效
│   │   ├── useHomeSettings.ts   # 主页设置：文件类型显示等
│   │   └── usePersisted.ts      # 通用持久化 Hook：内存缓存 + IPC 写入
│   │
│   ├── components/              # UI 组件
│   │   ├── Sidebar.tsx          # 左侧菜单栏：导航、拖拽排序
│   │   ├── Sidebar.css
│   │   ├── TitleBar.tsx         # 顶部标题栏：窗口控制、沉浸模式
│   │   ├── TitleBar.css
│   │   ├── Library.tsx          # 书库网格视图：封面、进度、类型标签
│   │   ├── Library.css
│   │   ├── ComicReader.tsx      # 阅读器核心：翻页、缩放、动效
│   │   ├── ComicReader.css
│   │   ├── SettingsModal.tsx    # 设置弹窗：侧栏分组、各项设置
│   │   ├── SettingsModal.css
│   │   ├── RecentReading.tsx    # 最近阅读视图
│   │   ├── Search.tsx           # 搜索视图
│   │
│   └── store/
│       └── toast.tsx            # Toast 通知系统
│
├── dist/                        # Vite 构建产物（渲染进程）
├── dist-electron/               # Electron 编译产物（主进程）
├── package.json                 # 项目配置
├── vite.config.ts               # Vite 配置
├── tsconfig.json                # TypeScript 配置
├── tsconfig.electron.json       # Electron 专用 TS 配置
└── .gitignore
```

---

## 3. 已实现功能清单

### 3.1 界面布局
| 功能 | 说明 | 关键文件 |
|------|------|----------|
| 无边框窗口 | 自定义标题栏，支持拖拽移动 | [TitleBar.tsx](file:///d:/CODE%20ALL/CODE%20X/Easy%20Comic/Easy%20Comic/src/components/TitleBar.tsx) |
| 侧边菜单栏 | 56px 宽，主色背景，支持拖拽排序 | [Sidebar.tsx](file:///d:/CODE%20ALL/CODE%20X/Easy%20Comic/Easy%20Comic/src/components/Sidebar.tsx) |
| 书库网格 | 自适应网格布局，封面最小 130px | [Library.tsx](file:///d:/CODE%20ALL/CODE%20X/Easy%20Comic/Easy%20Comic/src/components/Library.tsx) |
| 沉浸模式 | 全屏无 UI，边缘滑动唤出控制栏 | [ComicReader.tsx](file:///d:/CODE%20ALL/CODE%20X/Easy%20Comic/Easy%20Comic/src/components/ComicReader.tsx) |

### 3.2 格式支持
| 格式 | 扩展名 | 加载方式 | 状态 |
|------|--------|----------|------|
| CBZ/ZIP | .cbz, .zip | Worker 解压 ✅ | 已完成 |
| CBR/RAR | .cbr, .rar | Worker 解压 ✅ | 已完成 |
| CB7/7Z | .cb7, .7z | Worker 解压 ✅ | 已完成 |
| CBT/TAR | .cbt, .tar | Worker 解压 ✅ | 已完成 |
| PDF | .pdf | 主进程加载（pdfjs-dist，隐藏 BrowserWindow 渲染） | 已完成 |
| EPUB | .epub | Worker 解析 OPF spine | 已完成 |
| FB2 | .fb2 | 主进程加载 | 已完成 |
| 图片文件夹 | 目录 | 直接读取 | 已完成 |
| 单张图片 | .jpg/.png/.webp 等 | 直接读取 | 已完成 |

### 3.3 阅读功能
| 功能 | 说明 | 关键文件 |
|------|------|----------|
| 三种阅读模式 | 单页/双页/滚动拼接 | [useReaderSettings.ts](file:///d:/CODE%20ALL/CODE%20X/Easy%20Comic/Easy%20Comic/src/comic/useReaderSettings.ts) |
| 翻页动效 | 仿真翻书/滑入/无动效 | ComicReader.css |
| 页面顺序 | 从左到右/从右到左（日式） | ComicReader.tsx |
| 缩放控制 | 单/双页上限 100%，滚动上限 400% | ComicReader.tsx |
| 进度自动保存 | 翻页时自动保存阅读进度 | useComicLibrary.ts |
| 页码显示 | 沉浸模式右下角半透明页码 | ComicReader.css |
| 键盘操作 | ←→ 翻页，Esc 返回，F 全屏 | ComicReader.tsx |

### 3.4 设置面板
| 分类 | 选项 | 说明 |
|------|------|------|
| 主页设置 | 显示文件类型 | 控制书库卡片是否显示格式标签 |
| 阅读设置 | 阅读模式 | 单页/双页/滚动 |
| | 翻页动效 | 翻书/滑入/无 |
| | 页面顺序 | 普通/日式 |
| | 缩放比例 | 按模式分别存储 |
| | 显示页码 | 沉浸模式下是否显示 |
| 关于 | 版本号 | 显示当前版本 |
| | 重启按钮 | 开发模式刷新页面，生产模式重启应用 |
| | 删除用户数据 | 清空所有本地数据 |

### 3.5 数据管理
| 功能 | 说明 | 关键文件 |
|------|------|----------|
| 文件夹扫描 | 递归扫描，识别漫画文件和图片文件夹 | comic-loader.ts |
| 批量导入 | 一次性导入整个文件夹的所有漫画 | useComicLibrary.ts |
| 单文件导入 | 打开单个漫画文件 | App.tsx |
| 进度持久化 | 阅读进度自动保存到 Electron store | useComicLibrary.ts |
| 封面管理 | 自动提取第一页缩略图，支持自定义封面 | Library.tsx |
| 删除与隐藏 | 支持删除单本、批量隐藏/显示 | App.tsx |

---

## 4. 当前开发状态

### 4.1 最近完成的功能
- ✅ **EPUB 加载顺序修复**：严格按照 OPF `<spine>` 标签的 `idref` 顺序渲染页面
- ✅ **PDF 支持**：使用 pdfjs-dist v4.10.38，支持主进程加载
- ✅ **文件夹扫描优化**：只识别纯图片文件夹，不导入包含子目录的文件夹
- ✅ **多格式单文件支持**：GIF、TIFF 等单张图片格式可独立导入
- ✅ **主页设置**：新增"显示文件类型"选项
- ✅ **重启功能**：关于页面的重启按钮（开发模式刷新，生产模式重启）

### 4.2 已知 Bug / 待优化项
| 问题 | 严重度 | 说明 |
|------|--------|------|
| 重启按钮开发模式无效 | 低 | 已修复：dev/prod 均做真正进程级重启，concurrently 改为 --kill-others-on-fail |
| RAR 格式解压能力待验证 | 中 | .cbr/.rar 与 .7z 共用 7zip-min 解压，需确认 7za 是否真支持 RAR |
| 大文件内存占用 | 高 | 阅读器一次性加载所有页面 base64，大漫画可能 OOM |
| 大文件加载速度 | 中 | 压缩包解压后全部转 Base64，内存占用大 |
| 缺少分页加载 | 高 | 目前一次性加载所有页面，大漫画可能 OOM |
| 封面生成异步 | 低 | 首次加载需要额外请求封面 |

### 4.3 正在进行的架构调整
- **Worker 化**：压缩包解压在 Worker 中执行，不阻塞 UI
- **缓存策略**：封面和已加载页面的缓存机制
- **虚拟滚动**：书库网格虚拟滚动支持大量漫画

---

## 5. 关键配置说明

### 5.1 package.json 脚本

```bash
# 开发：启动 Vite 开发服务器
npm run dev

# 开发：Electron + Vite 联合启动（主要开发命令）
npm run electron:dev
# 等价于：concurrently -k "vite" "wait-on http://localhost:5173 && tsc -p tsconfig.electron.json && cross-env NODE_ENV=development electron ."

# 生产构建
npm run build
# 等价于：tsc -b && vite build

# 打包分发
npm run electron:build
# 等价于：npm run build && tsc -p tsconfig.electron.json && electron-builder

# 预览构建产物
npm run preview
```

### 5.2 electron-builder 配置
```json
{
  "build": {
    "appId": "com.easycomic.app",
    "productName": "EasyComic",
    "directories": {
      "output": "release"
    },
    "files": ["dist/**/*", "dist-electron/**/*"],
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

### 5.3 .gitignore 关键忽略项
```
node_modules/
dist/
dist-electron/
release/
*.log
.DS_Store
Thumbs.db
```

---

## 6. 用户交互与设计规范

### 6.1 视觉风格
| 项目 | 规范 |
|------|------|
| 主色 | `#1E2020`（深灰黑） |
| 辅色 | `#E9E8EF`（浅灰白） |
| 主题 | 暗色主题 |
| 字体 | 系统默认无衬线字体 |
| 圆角 | 卡片 12px，按钮 8px |

### 6.2 交互规范
| 项目 | 规范 |
|------|------|
| 侧边栏宽度 | 56px，主色背景，右侧间隔线 |
| 封面尺寸 | 最小宽度 130px，间距 32px 24px |
| 进度条 | 高度 3px |
| 拖拽排序 | FLIP 动画（First Last Invert Play） |
| 侧栏拖拽 | `localStorage: easycomic:sidebar-order` |
| 设置动效 | 0.3s cubic-bezier 曲线 |
| 沉浸模式 | 边缘触发区与控制栏触发区严格分离 |

### 6.3 页面流转
```
书库 → 点击封面 → 加载动画 → 阅读器
  ↑                                    │
  │    Esc / 返回键 / 点击返回按钮       │
  └────────────────────────────────────┘
```

### 6.4 防冲突设计
- **阅读器边缘翻页区**：屏幕左右两侧各 40px 用于翻页
- **控制栏唤出区**：滑动距离 > 80px 时触发，不与翻页区重叠
- **取消加载**：Esc 键或左上角返回按钮（带 5 重校验防止竞态）

---

## 7. 编码规范与架构约定

### 7.1 状态管理
| 方式 | 用途 | 文件 |
|------|------|------|
| `usePersisted` Hook | 全局持久化状态（书库、设置、进度） | usePersisted.ts |
| `useState` | 组件内临时状态 | 各组件 |
| `useRef` | 引用型状态（避免重渲染） | App.tsx |

`usePersisted` 三级存储策略：
1. 内存缓存（同 key 跨组件共享）
2. Electron userData JSON 文件（升级不丢失）
3. localStorage（浏览器预览降级）

### 7.2 IPC 通信模式
```typescript
// preload.ts 中暴露 API
contextBridge.exposeInMainWorld('electronAPI', {
  window: { minimize, maximize, close, isMaximized },
  comic: { pickFolder, pickFile, load, scanFolder, pickCoverImage },
  store: { read, write, delete, clearAll },
  app: { getVersion, relaunch }
})

// 主进程 handler
ipcMain.handle('comic:load', async (_e, sourcePath) => { ... })

// 渲染进程调用
const result = await window.electronAPI.comic.load(sourcePath)
```

### 7.3 Worker 使用约定
```typescript
// 适合 Worker 的任务（CJS 兼容）
const worker = new Worker(path.join(__dirname, 'comic-worker.js'), {
  workerData: { sourcePath }
})
worker.on('message', (msg) => { ... })

// 不适合 Worker 的任务（ESM 依赖）→ 主进程直接加载
const MAIN_PROCESS_FORMATS = new Set(['.pdf', '.fb2'])
```

### 7.4 文件命名与组织
- **组件**：`PascalCase.tsx` + `PascalCase.css`
- **Hook**：`useCamelCase.ts`
- **类型**：集中在 `src/types/` 下
- **Electron**：`.ts` 源文件在 `electron/`，编译产物在 `dist-electron/`

---

## 8. 待办事项与未来计划

### 8.1 高优先级
| 任务 | 说明 |
|------|------|
| 分页懒加载 | 不要一次性加载所有页面到内存，按需加载 + 缓存 |
| RAR 格式完整支持 | 验证/补全 .cbr/.rar 解压能力（当前与 7z 共用 7zip-min） |
| PDF 隐藏窗口健壮性 | 增加渲染超时、崩溃自愈、逐页/分批 IPC 回传 |
| 缩略图缓存 | 封面生成后缓存到磁盘，避免重复计算 |

### 8.2 中优先级
| 任务 | 说明 |
|------|------|
| 书签/标注 | 添加书签功能和阅读标注 |
| 多语言支持 | i18n 框架（目前仅中文） |
| 云同步 | 可选的云端备份同步 |
| 快捷键自定义 | 用户可自定义快捷键 |

### 8.3 低优先级
| 任务 | 说明 |
|------|------|
| 插件系统 | 允许第三方扩展格式支持 |
| 主题编辑器 | 自定义主题颜色 |
| 统计功能 | 阅读时长、进度统计 |

---

## 9. 构建、运行与发布命令

### 开发环境启动
```bash
# 1. 安装依赖
npm install

# 2. 开发模式（推荐）
npm run electron:dev
# 这会同时启动：
#   - Vite dev server (http://localhost:5173)
#   - Electron 窗口（加载 dev server）

# 3. 仅启动 Vite（浏览器预览）
npm run dev
# 注意：浏览器模式下无法访问本地文件系统，导入功能不可用
```

### 生产构建
```bash
# 1. 构建前端
npm run build

# 2. 编译 Electron 主进程
tsc -p tsconfig.electron.json

# 3. 本地预览（不打包）
npm run preview

# 4. 打包分发型（生成安装包）
npm run electron:build
# 输出目录：release/
# 产物：EasyComic Setup x.x.x.exe
```

### 测试命令
```bash
# 暂无单元测试
# 手动测试：启动应用后测试各项功能
npm run electron:dev
```

---

## 10. 向新 AI 助手的特别说明

### 10.1 核心注意事项

1. **压缩包递归解压**
   - 支持 CBZ/ZIP、CBR/RAR、CB7/7Z、CBT/TAR 嵌套
   - PDF/EPUB/FB2/DJVU 是文档格式，不递归
   - 嵌套格式由 `NESTABLE_EXTS` 集合控制

2. **EPUB spine 顺序**
   - 必须解析 `META-INF/container.xml` 找到 OPF 文件
   - 按 `<spine>` 标签的 `idref` 顺序渲染
   - 忽略非 spine 引用的文件（如独立封面图）

3. **PDF 版本坑**
   - 当前使用 `pdfjs-dist@4.10.38`（CJS 版本）
   - v6+ 是 ESM 版本，Worker 线程无法 require
   - Worker 路径必须对应安装的版本（legacy/build vs build）

4. **扫描逻辑**
   - `scanFolder` 只识别"纯图片文件夹"（无任何子目录）
   - 含子目录的文件夹标记为 `'mixed'` 并跳过
   - 根目录的压缩包/文档/单图文件都会被识别

5. **自然排序**
   - 所有图片按文件名自然排序（`naturalSplit` + `compareNatural`）
   - 数值部分按大小比较，字符串部分按字典序
   - 忽略路径和扩展名

### 10.2 性能优化原则

1. **避免阻塞主线程**
   - 压缩包解压 → Worker 线程
   - 大量文件扫描 → 分批处理 + 进度回调
   - 图片解码 → Web Worker

2. **内存管理**
   - 不要将所有页面的 dataUrl 同时保存在内存
   - 使用 LRU 缓存淘汰已访问页面
   - 大漫画考虑分帧加载

3. **写入节流**
   - `usePersisted` 已有 120ms 写入节流
   - 不要在循环内频繁调用 `setValue`

### 10.3 常见问题排查

| 问题 | 排查方向 |
|------|----------|
| 白屏 | 检查 Vite dev server 是否运行、端口 5173 是否被占用 |
| 导入失败 | 检查 `comic-loader.ts` 中对应格式的 load 函数日志 |
| PDF 无法加载 | 检查 pdfjs-dist 版本、Worker 路径是否存在 |
| EPUB 顺序错误 | 检查 spine 解析逻辑是否正确 |
| 数据丢失 | 检查 `usePersisted` 的初始化时序，是否在首次读取前就写入了 |
| 拖拽失效 | 检查 `localStorage: easycomic:sidebar-order` 是否存在 |

### 10.4 开发建议

1. **调试技巧**
   - 主进程日志：Electron 终端输出
   - 渲染进程日志：DevTools Console
   - IPC 通信：搜索 `[EasyComic]` 前缀日志

2. **新增格式支持**
   - 在 `comic-loader.ts` 中添加 `ARCHIVE_EXTS` 映射
   - 实现对应的 `loadXxx` 函数
   - 如果是 ESM 依赖，加入 `MAIN_PROCESS_FORMATS`
   - 更新 `preload.ts` 的文件选择对话框 filter

3. **UI 修改要点**
   - 主色 `#1E2020`，辅色 `#E9E8EF`
   - 侧边栏宽度 56px，不要修改
   - 封面最小宽度 130px，间距 32px 24px
   - 所有动效使用 `transform` 而非 `top/left`

4. **数据迁移**
   - 版本升级时，在 `useComicLibrary.ts` 的 `useEffect` 中添加迁移逻辑
   - 使用 `usePersisted` 的 `normalize` 模式处理旧数据兼容

---

## 附录：关键代码位置索引

| 功能 | 文件 | 关键函数/组件 |
|------|------|---------------|
| 漫画加载主入口 | `electron/comic-loader.ts` | `loadComic()` |
| 文件夹扫描 | `electron/comic-loader.ts` | `scanFolder()` |
| ZIP 解压 | `electron/comic-loader.ts` | `loadZip()` |
| RAR 解压 | `electron/comic-loader.ts` | `loadRar()` |
| 7Z 解压 | `electron/comic-loader.ts` | `load7z()` |
| TAR 解压 | `electron/comic-loader.ts` | `loadTar()` |
| PDF 加载 | `electron/comic-loader.ts` | `loadPdf()` |
| EPUB 加载 | `electron/comic-loader.ts` | `loadEpub()` |
| FB2 加载 | `electron/comic-loader.ts` | `loadFb2()` |
| Worker 消息处理 | `electron/comic-worker.ts` | `parentPort.on('message', ...)` |
| 书库状态管理 | `src/comic/useComicLibrary.ts` | `useComicLibrary()` |
| 阅读器设置 | `src/comic/useReaderSettings.ts` | `useReaderSettings()` |
| 主页设置 | `src/comic/useHomeSettings.ts` | `useHomeSettings()` |
| 通用持久化 | `src/comic/usePersisted.ts` | `usePersisted()`, `clearAllPersisted()` |
| 阅读器组件 | `src/components/ComicReader.tsx` | `ComicReader`, `SettingsPanel` |
| 设置弹窗 | `src/components/SettingsModal.tsx` | `SettingsModal` |
| 侧边栏拖拽 | `src/components/Sidebar.tsx` | `Sidebar` (含 FLIP 动画) |
| 书库网格 | `src/components/Library.tsx` | `Library` |
| 主窗口 IPC | `electron/main.ts` | 所有 `ipcMain.handle()` |
| Preload API | `electron/preload.ts` | `contextBridge.exposeInMainWorld()` |
