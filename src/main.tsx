import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 全局拦截「文件拖放」，避免把文件拖到窗口空白处时 Electron 跳转/重新加载页面。
// 仅在拖拽类型为 Files 时拦截；应用内部的 HTML5 拖拽（如侧边栏排序）不受影响。
const isFileDragEvent = (e: DragEvent): boolean =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files')

document.addEventListener('dragover', (e) => {
  if (isFileDragEvent(e)) e.preventDefault()
})
document.addEventListener('drop', (e) => {
  if (isFileDragEvent(e)) e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
