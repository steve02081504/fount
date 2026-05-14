/**
 * 兼容入口：重定向至 Hub（`?char=` 与 hash 原样保留，由 Hub 解析）。
 */
const q = window.location.search || ''
const h = window.location.hash || ''
window.location.replace(`/parts/shells:chat/hub/${q}${h}`)
