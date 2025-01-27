export const applyTheme = () => {
	const is_dark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
	document.documentElement.setAttribute('data-theme', is_dark ? 'dark' : 'light')
	return is_dark
}
