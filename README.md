<div align="center">

<img src="build/icon.png" alt="EasyComic" width="120" height="120">

# EasyComic 易漫画

### 漫画就是如此简单 —— 一款轻量、纯净、沉浸、全能的本地漫画阅读器

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-success.svg)]()
[![Format](https://img.shields.io/badge/Formats-CBZ%20%7C%20CBR%20%7C%20PDF%20%7C%20EPUB%20%7C%20...-orange.svg)]()

</div>

---

> 🍃 **不联网、不注册、不广告、不收集。**
> 把漫画文件丢进来，剩下的交给 EasyComic。

如果你厌倦了在线阅读器的弹窗、登录、资源被删、阅读记录被上传——EasyComic 给你另一种选择：**所有漫画都存在你自己的电脑里，所有进度都只属于你。**

---

## ✨ 为什么选 EasyComic

### 📚 几乎什么格式都能读
不管你的漫画是从哪来的、是什么格式，EasyComic 基本都能直接打开：

| 类型 | 支持格式 |
|------|----------|
| 漫画压缩包 | **CBZ / CBR / CB7 / CBT**（ZIP / RAR / 7Z / TAR） |
| 文档格式 | **PDF / EPUB / FB2** |
| 图片系列 | **图片文件夹**（自动识别排序） |
| 单张图片 | JPG / PNG / WEBP / GIF / TIFF … |

> 嵌套压缩包也能递归解开，再也不用手动解压"包中包"。

### 📖 三种阅读模式，日漫 / 国漫 / 条漫通吃
- **单页模式** —— 适合大多数日漫、美漫
- **双页模式** —— 跨页大图不再被切断，原汁原味的"翻开书"体验
- **连续条漫（拼接滚动）** —— 韩漫、国漫条漫一口气滑到底，无需频繁翻页

### 🔄 翻页方向你说了算
- **普通（左翻）** —— 适配国漫、美漫
- **日式（右翻）** —— 还原日漫"从右往左"的阅读习惯

### 📜 翻页动效，有仪式感
- 仿真翻书 / 滑入 / 无动效，三种可选
- 想要"纸质书翻页感"还是"干脆利落"，一键切换

### 🌌 沉浸式全屏阅读
进入阅读器后，所有 UI 自动隐去，只剩漫画本身。屏幕边缘轻滑即可唤出控制栏，不打扰你的沉浸感。

### 💾 进度自动记忆
翻到哪一页，关掉；下次打开同一本，**接着上次的位置继续读**。书架封面还会显示阅读进度条，追更进度一目了然。

### 🖼️ 自动封面 + 书架管理
- 导入后自动提取第一页作为封面
- 支持自定义封面
- 书库网格自适应布局，封面再多也不乱
- 侧边栏可拖拽排序，按你的习惯组织

### ⚡ 解压不卡顿
压缩包解压在后台 Worker 线程进行，**打开大漫画时界面依然流畅**，不会"转圈卡死"。

### 🌙 暗色护眼主题
深灰黑主色调，长时间阅读不刺眼，夜晚追漫更舒适。

### 🔒 纯本地，真隐私
- **不联网**（除"检查更新"可选）
- **不注册账号**
- **不上传任何数据**
- 所有漫画文件、阅读进度、设置都只存在你电脑的 `%APPDATA%/EasyComic/` 目录下
- 卸载也不会残留到别处

---

## 🚀 下载安装

### 方式一：下载安装包（推荐普通用户）
1. 前往 [Releases 页面](https://github.com/MoonCore-Dev/EasyComic/releases)
2. 下载最新版的 `EasyComic Setup x.x.x.exe`
3. 双击运行安装即可

> ⚠️ 由于未购买代码签名证书，Windows 首次运行可能弹出 SmartScreen 警告，点击 **"更多信息" → "仍要运行"** 即可，软件本身是安全的（开源可自查代码）。

### 方式二：从源码运行（开发者）
```bash
git clone https://github.com/MoonCore-Dev/EasyComic.git
cd EasyComic
npm install
npm run electron:dev
```

打包生成安装包：
```bash
npm run electron:build
# 产物在 release/ 目录
```

---

## ⌨️ 快捷键速查

| 按键 | 功能 |
|------|------|
| `←` / `→` | 上一页 / 下一页 |
| `Esc` | 返回书库 |
| `F` | 全屏 / 退出全屏 |
| `Ctrl` + `滚轮` | 缩放（阅读器内） |
| 鼠标滚轮 | 连续模式下滚动阅读 |

---

## 📋 功能一览

- ✅ 多格式支持（CBZ/CBR/CB7/CBT/PDF/EPUB/FB2/图片文件夹/单图）
- ✅ 单页 / 双页 / 连续条漫三种阅读模式
- ✅ 左翻 / 日式右翻
- ✅ 仿真翻书 / 滑入 / 无动效
- ✅ 沉浸式全屏 + 边缘唤出控制栏
- ✅ 阅读进度自动保存 + 封面进度条
- ✅ 自动提取封面 + 自定义封面
- ✅ 书库网格 + 侧边栏拖拽排序
- ✅ 文件夹批量导入 + 递归扫描
- ✅ 暗色护眼主题
- ✅ 纯本地运行，零联网零上传
- ✅ 中文原生界面

---

## 📱 移动端

🚧 **安卓版正在开发中（Kotlin + Jetpack Compose 原生）！**

目前 EasyComic 已提供 Windows 桌面版，安卓原生版本正在开发中，目标是最大程度复刻桌面版美术风格与交互，并对中低端设备做性能优化。iOS 版本暂未排期。

> 想从源码参与安卓版开发？请看本文件下方的 **「🤖 构建安卓版」** 一节。

---

## 🤖 构建安卓版（Android / Kotlin + Jetpack Compose）

安卓版是一个**完全独立**的 Gradle 工程，位于仓库根目录的 `android/` 子目录，仅与桌面版共享同一个 Git 仓库，**不引用、不依赖桌面版的任何代码与构建产物**。

```
EasyComic/                 ← 仓库根目录（桌面版 + 安卓版共存）
├─ src/  electron/  package.json …   ← 桌面版（Electron + React + TS），保持不变
└─ android/                ← 安卓原生工程（Kotlin + Compose），独立工程
   ├─ settings.gradle.kts
   ├─ build.gradle.kts
   ├─ gradle.properties
   ├─ gradlew / gradlew.bat
   └─ app/                 ← Android 应用模块（包名 com.easycomic）
```

### 环境要求
- **Android Studio**（含自带 JDK 17、Android SDK、模拟器）
- Android SDK Platform **34** + Build-Tools + Platform-Tools
- 推荐：一台**中低端真机**或低 RAM 模拟器（用于弱设备性能验证）

> ⚠️ 本机若装有系统级 JDK（如 JDK 26），请用 **Android Studio 自带的 JDK 17** 构建，避免与 Android Gradle Plugin 不兼容。

### 用 Android Studio 打开
1. 启动 Android Studio → **Open** → 选择仓库根目录下的 **`android/`** 文件夹（不要选仓库根目录）。
2. 首次打开会自动下载 Gradle 并同步依赖（需联网）。
3. 同步完成后，左侧 Project 面板即显示 `EasyComic` 安卓工程。

### 运行（调试）
- 连接 Android 设备或启动模拟器（AVD）。
- 点击工具栏 **Run ▶**（或 `Shift + F10`），选择设备即可安装并启动，看到一个深色「EasyComic / 安卓版开发中」占位界面即代表工程骨架正常。

### 构建 APK（发布用）
- 菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**。
- 产物位于：`android/app/build/outputs/apk/debug/` 或 `release/`。
- 也可在 `android/` 目录下执行命令行构建：
  ```bash
  cd android
  ./gradlew assembleDebug      # 调试包
  ./gradlew assembleRelease    # 发布包（需自行配置签名）
  ```

### 版本号管理（与桌面版相互独立）
两个平台版本号**分开维护**，互不影响：

| 平台 | 版本号位置 | 示例 |
|------|-----------|------|
| 桌面版（Windows） | 根目录 `package.json` 的 `version` | `"version": "1.2.1"` |
| 安卓版 | `android/app/build.gradle.kts` 的 `versionName` / `versionCode` | `versionName = "0.1.0"`、`versionCode = 1` |

> 发布安卓时，请按语义化版本递增 `versionName`，并让 `versionCode` 单调递增（每次发布 +1）。

### 💡 IDE 使用提醒（避免索引混乱）
- **桌面版开发**：用 VS Code / Trae 打开**仓库根目录**，处理 `src/`、`electron/`、`package.json` 等。
- **安卓版开发**：用 **Android Studio 只打开 `android/` 文件夹**，不要把仓库根目录当作安卓工程打开，否则 Gradle/索引会错误地把桌面文件纳入安卓工程。

### 📝 Git 提交规范（区分平台）
为清晰区分改动归属，提交信息统一使用平台前缀：

| 前缀 | 含义 |
|------|------|
| `feat(desktop):` / `fix(desktop):` | 桌面版（Electron + React）相关改动 |
| `feat(android):` / `fix(android):` | 安卓版（Kotlin + Compose）相关改动 |
| `docs:` / `chore:` | 跨平台文档或仓库级杂项 |

示例：
```
feat(android): 初始化 Kotlin + Compose 工程骨架
fix(desktop): 修复导入单文件偶发扫描整个桌面
```

---

## 🤝 参与贡献

欢迎提 Issue 反馈 bug、提功能建议，或直接 Pull Request。

开发模式启动：
```bash
npm run electron:dev
```

技术栈：
- 桌面版：**Electron 31 + React 18 + TypeScript 5 + Vite 5**
- 安卓版：**Kotlin + Jetpack Compose（Android Gradle Plugin 8.5 + Compose BOM 2024.09）**

---

## 📄 版权与许可

版权 © 2025 [MoonCore-Dev](https://github.com/MoonCore-Dev)。本项目采用 [GNU General Public License v3.0](LICENSE) 许可证。

任何人可以自由使用、修改和分发本软件，但衍生项目必须同样以 GPL v3 开源。

---

## ⚖️ 免责声明

**本软件仅用于个人合法拥有的漫画内容阅读，不提供任何漫画资源，不鼓励或支持盗版。用户使用本软件阅读非授权内容产生的法律风险由用户自行承担，开发者不承担任何责任。**

---

<div align="center">

**用 EasyComic，漫画就是如此简单。**

⭐ 如果这个项目对你有帮助，欢迎 Star 支持一下！

</div>
