window.urlParams = new URLSearchParams(window.location.search)
document.documentElement.setAttribute('data-theme',
	(urlParams.get('theme') ?? localStorage.getItem('fountTheme')) ||
	Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
)
