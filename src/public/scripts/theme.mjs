export const applyTheme = () => {
	document.documentElement.setAttribute(
		'data-theme',
		window.matchMedia('(prefers-color-scheme: dark)').matches
			? 'dark'
			: 'light'
	)
}
