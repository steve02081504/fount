import { fixTailwindcssCDN } from './scripts/tailwindcssCdnFixer.mjs'

fixTailwindcssCDN()
if ('serviceWorker' in navigator)
	navigator.serviceWorker.register('/service_worker.mjs', { scope: '/', module: true })
		.then(registration => {
			console.log('Service Worker registered successfully with scope: ', registration.scope)
		})
		.catch(error => {
			console.error('Service Worker registration failed: ', error)
		})
