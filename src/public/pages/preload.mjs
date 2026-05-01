const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
document.documentElement.colorScheme = 'only ' + colorScheme
document.documentElement.dataset.theme = localStorage.getItem('theme') || colorScheme
