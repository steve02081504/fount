document.documentElement.dataset.theme = localStorage.getItem('theme') || (
	window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
)
