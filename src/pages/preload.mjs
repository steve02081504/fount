/**
 * @description 设置页面的主题。
 * @param {string} theme - 主题名称。
 */
document.documentElement.setAttribute('data-theme',
	localStorage.getItem('theme') ||
		Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
)
