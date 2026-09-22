const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
const scheme = 'only ' + colorScheme
// 渲染前的最早写入：color-scheme 属性供 shiki 双主题选择器匹配，base.css 由属性派生 CSS 属性。
// 此处不可 import 主题包（会拖入 esm.sh）；页面加载后由 theme/index.mjs 的 applyColorScheme 接管。
document.documentElement.setAttribute('color-scheme', scheme)
document.documentElement.dataset.theme = localStorage.getItem('theme') || colorScheme
