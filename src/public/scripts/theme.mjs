export const applyTheme = () => {
	document.documentElement.setAttribute(
		'data-theme',
		window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
			? 'dark'
			: 'light'
	)
}
