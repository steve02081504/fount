const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
const scheme = 'only ' + colorScheme
// 属性供 shiki 双主题选择器 [color-scheme*="…"] 匹配；同时设置 CSS 属性以屏蔽 Chrome 自动深色
document.documentElement.setAttribute('color-scheme', document.documentElement.style.colorScheme = scheme)
document.documentElement.dataset.theme = localStorage.getItem('theme') || colorScheme
