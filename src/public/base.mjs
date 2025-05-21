// load Sentry

/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.run/@sentry/browser'

Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	sendDefaultPii: true,
	tunnel: '/api/sentrytunnel',
	integrations: [
		Sentry.replayIntegration(),
		Sentry.browserTracingIntegration(),
		Sentry.browserProfilingIntegration()
	],
	// Performance Monitoring
	tracesSampleRate: 1.0,
	tracePropagationTargets: [window.location.origin || 'localhost'],
	// Session Replay
	replaysSessionSampleRate: 0.1,
	replaysOnErrorSampleRate: 1.0,
	// Profiling
	profilesSampleRate: 1.0,
	// Logging
	_experiments: { enableLogs: true },
})

// fix of tailwindcss Play CDN
import { fixTailwindcssCDN } from './scripts/tailwindcssCdnFixer.mjs'
fixTailwindcssCDN()

// register service worker
if ('serviceWorker' in navigator)
	navigator.serviceWorker.register('/service_worker.mjs', { scope: '/', module: true })
		.catch(error => {
			console.error('Service Worker registration failed: ', error)
		})

// set prerender rules
if (HTMLScriptElement.supports?.('speculationrules')) {
	const specScript = document.createElement('script')
	specScript.type = 'speculationrules'
	specScript.textContent = JSON.stringify({
		prerender: [{
			where: {
				href_matches: '/*'
			},
			eagerness: 'moderate'
		}]
	})
	document.head.prepend(specScript)
}

// esc按键
document.addEventListener('keydown', event => {
	if (event.key === 'Escape')
		if (history.length > 1) history.back()
		else window.close()
})
