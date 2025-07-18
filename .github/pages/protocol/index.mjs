/* global urlParams */
import '../base.mjs'
import * as Sentry from 'https://esm.run/@sentry/browser'
import { getFountHostUrl } from '../scripts/fountHostGetter.mjs'
import { initTranslations, geti18n } from '../scripts/i18n.mjs'

const fountProtocolUrl = urlParams.get('url')

/**
 * @param {string} hostUrl
 */
async function ping(hostUrl) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), 1000)
	const res = await fetch(new URL('/api/ping', hostUrl), {
		signal: controller.signal,
	}).catch(() => null)
	clearTimeout(timeout)
	return res?.ok ?? false
}

async function main() {
	await initTranslations('protocolhandler')
	const hostUrl = localStorage.getItem('hostUrl')
	if (hostUrl) {
		const isOnline = await ping(hostUrl)
		if (isOnline) {
			const redirectUrl = fountProtocolUrl
				? new URL('/protocolhandler', hostUrl)
				: new URL('/shells/home', hostUrl)
			if (fountProtocolUrl) {
				redirectUrl.searchParams.set('url', fountProtocolUrl)
				redirectUrl.searchParams.set('from', 'jumppage')
			}
			window.location.href = redirectUrl.href
			return
		}

		const url = new URL(hostUrl)
		if (['localhost', '127.0.0.1'].includes(url.hostname)) {
			if (fountProtocolUrl) {
				window.open(fountProtocolUrl, '_self')
				return
			}
		}
	}

	const newHostUrl = await getFountHostUrl()
	if (newHostUrl) {
		const redirectUrl = fountProtocolUrl
			? new URL('/protocolhandler', newHostUrl)
			: new URL('/shells/home', newHostUrl)
		if (fountProtocolUrl) {
			redirectUrl.searchParams.set('url', fountProtocolUrl)
			redirectUrl.searchParams.set('from', 'jumppage')
		}
		window.location.href = redirectUrl.href
	}
	else {
		alert(geti18n('protocolhandler.fountNotFound'))
		window.location.href = 'https://github.com/steve02081504/fount'
	}
}

main().catch(e => {
	Sentry.captureException(e)
	alert(geti18n('protocolhandler.unknownError') + e.message)
	window.location.href = 'https://github.com/steve02081504/fount'
})
