document.documentElement.dataset.theme = localStorage.getItem('theme') || (
	Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
)
