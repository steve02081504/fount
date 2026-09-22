/* global urlParams */
import { retrieveUrlParams } from './scripts/host/urlDataTransfer.mjs'
window.urlParams = await retrieveUrlParams(new URLSearchParams(window.location.search))
const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
const scheme = 'only ' + colorScheme
// 属性供 shiki 双主题选择器 [color-scheme*="…"] 匹配；base.css 由属性派生 CSS color-scheme 属性。
// 与 theme/index.mjs 的 applyColorScheme 是同一套写入（渲染前无法 import 主题包）。
document.documentElement.setAttribute('color-scheme', scheme)
document.documentElement.dataset.theme = (urlParams.get('theme') ?? localStorage.getItem('fountTheme')) || colorScheme
