// load Sentry
import * as Sentry from "https://esm.run/@sentry/browser"
Sentry.init({
	dsn: "https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704",
	sendDefaultPii: true
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
