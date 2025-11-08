/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { svgInliner } from './scripts/svgInliner.mjs'

Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	sendDefaultPii: true,
	integrations: [
		Sentry.browserTracingIntegration()
	],
	// Performance Monitoring
	tracesSampleRate: 1.0,
	tracePropagationTargets: [window.location.origin || 'https://steve02081504.github.io'],
})

await import('https://cdn.jsdelivr.net/gh/steve02081504/js-polyfill/index.mjs').catch(console.error)

/* global urlParams */
/**
 * 当前应用程序的主题
 */
export let theme_now
/**
 * 设置应用程序的主题。
 * @param {string} theme - 要设置的主题（例如 'dark', 'light', 'auto'）。
 */
export function setTheme(theme) {
	if (theme === theme_now) return
	theme_now = theme
	localStorage.setItem('fountTheme', theme)
	if (theme === 'auto') theme = null
	theme ||= window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
	if (document.documentElement.dataset.theme !== theme) document.documentElement.setAttribute('data-theme', theme)
}
setTheme(urlParams.get('theme') ?? localStorage.getItem('fountTheme') ?? 'dark')
svgInliner(document)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
	setTheme(localStorage.getItem('theme'))
})

/**
 * 设置预渲染。
 * @param {string} [hostUrl] - 主机 URL。
 */
export function setPreRender(hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl') ?? 'http://localhost:8931') {
	if (HTMLScriptElement.supports?.('speculationrules')) {
		const specScript = document.createElement('script')
		specScript.type = 'speculationrules'
		specScript.textContent = JSON.stringify({
			prerender: [{
				urls: [hostUrl + '/shells/home']
			}]
		})
		document.head.prepend(specScript)
	}
	else {
		const link = document.createElement('link')
		link.rel = 'prerender'
		link.href = hostUrl + '/shells/home'
		document.head.prepend(link)
	}
}

/**
 * 应用程序的基础目录
 */
export const base_dir = '../'.repeat(window.location.pathname.split('/').length - 3).slice(0, -1)

if ('serviceWorker' in navigator)
	navigator.serviceWorker.register('/sw.js')
		.catch(error => {
			console.error('Service Worker registration failed: ', error)
		})

; (f => document.readyState === 'complete' ? f() : window.addEventListener('load', f))(async () => {
	try {
		console.log(...await fetch('https://cdn.jsdelivr.net/gh/steve02081504/fount/imgs/icon.js').then(r => r.text()).then(eval))
	} catch (error) { console.error(error) }
	console.log('Curious? Join us and build future together: https://github.com/steve02081504/fount')
})
