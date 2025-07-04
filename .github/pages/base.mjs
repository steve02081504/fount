/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.run/@sentry/browser'

Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	sendDefaultPii: true,
	integrations: [
		Sentry.replayIntegration(),
		Sentry.browserTracingIntegration(),
		Sentry.browserProfilingIntegration()
	],
	// Performance Monitoring
	tracesSampleRate: 1.0,
	tracePropagationTargets: [window.location.origin || 'https://steve02081504.github.io'],
	// Session Replay
	replaysSessionSampleRate: 0.1,
	replaysOnErrorSampleRate: 1.0,
	// Profiling
	profilesSampleRate: 1.0,
	// Logging
	_experiments: { enableLogs: true },
})

await import('https://cdn.jsdelivr.net/gh/steve02081504/js-polyfill@master/index.mjs')

export let theme_now
export function setTheme(theme) {
	if (theme === theme_now) return
	theme_now = theme
	localStorage.setItem('fountTheme', theme)
	if (theme === 'auto') theme = null
	theme ||= Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
	if (document.documentElement.dataset.theme !== theme) document.documentElement.setAttribute('data-theme', theme)
}
setTheme(urlParams.get('theme') ?? localStorage.getItem('fountTheme') ?? 'dark')
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
	setTheme(localStorage.getItem('theme'))
})

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

export let base_dir = '..'
export function setBaseDir(v) {
	base_dir = v
}
