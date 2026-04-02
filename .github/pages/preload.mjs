/* global urlParams */
import { retrieveUrlParams } from './scripts/urlDataTransfer.mjs'
window.urlParams = await retrieveUrlParams(new URLSearchParams(window.location.search))
const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
document.documentElement.colorScheme = 'only ' + colorScheme
document.documentElement.dataset.theme = (urlParams.get('theme') ?? localStorage.getItem('fountTheme')) || colorScheme
