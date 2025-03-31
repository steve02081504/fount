import { fixTailwindcssCDN } from './scripts/tailwindcssCdnFixer.mjs'

fixTailwindcssCDN()
if ('serviceWorker' in navigator)
	navigator.serviceWorker.register('/service_worker.mjs', { scope: '/', module: true })
		.catch(error => {
			console.error('Service Worker registration failed: ', error)
		})
