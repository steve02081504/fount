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
	}).catch(() => 0)
	clearTimeout(timeout)
	return res?.ok
}

function useUrlProtocol(hostUrl) {
	const redirectUrl = fountProtocolUrl
		? new URL('/protocolhandler', hostUrl)
		: new URL('/shells/home', hostUrl)
	if (fountProtocolUrl) {
		redirectUrl.searchParams.set('url', fountProtocolUrl)
		redirectUrl.searchParams.set('from', 'jumppage')
	}
	window.location.href = redirectUrl.href
}

async function main() {
	await initTranslations('protocolhandler')
	const hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')
	if (hostUrl) {
		const isOnline = await ping(hostUrl)
		if (isOnline) return useUrlProtocol(hostUrl)

		const url = new URL(hostUrl)
		if (fountProtocolUrl && ['localhost', '127.0.0.1'].includes(url.hostname))
			return window.open(fountProtocolUrl, '_self')
	}

	const newHostUrl = await getFountHostUrl()
	if (newHostUrl)
		return useUrlProtocol(newHostUrl)
	alert(geti18n('protocolhandler.fountNotFound'))
	window.location.href = 'https://github.com/steve02081504/fount'
}

main().catch(e => {
	Sentry.captureException(e)
	alert(geti18n('protocolhandler.unknownError') + e.message)
	window.location.href = 'https://github.com/steve02081504/fount'
})
