/* global urlParams */
import { retrieveUrlParams } from './scripts/urlDataTransfer.mjs'
window.urlParams = await retrieveUrlParams(new URLSearchParams(window.location.search))
document.documentElement.dataset.theme = (urlParams.get('theme') ?? localStorage.getItem('fountTheme')) || (
	window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
)
