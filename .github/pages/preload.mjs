/* global urlParams */
import { retrieveUrlParams } from './scripts/urlDataTransfer.mjs'
window.urlParams = await retrieveUrlParams(new URLSearchParams(window.location.search))
document.documentElement.setAttribute('data-theme',
	(urlParams.get('theme') ?? localStorage.getItem('fountTheme')) || (
		Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
	)
)
