/* global urlParams */
import '../base.mjs'
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { getFountHostUrl, pingFount } from '../scripts/fountHostGetter.mjs'
import { initTranslations } from '../scripts/i18n.mjs'
import { showToastI18n } from '../scripts/toast.mjs'

const fountProtocolUrl = urlParams.get('url')

function useUrlProtocol(hostUrl) {
	if (fountProtocolUrl) {
		const redirectUrl = new URL('/protocolhandler', hostUrl)
		redirectUrl.searchParams.set('url', fountProtocolUrl)
		redirectUrl.searchParams.set('from', 'jumppage')
		window.location.href = redirectUrl.href
	}
	else
		window.location.href = new URL('/shells/home', hostUrl).href
}

async function main() {
	await initTranslations('protocolhandler')
	const hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')
	if (hostUrl) {
		const isOnline = await pingFount(hostUrl)
		if (isOnline) return useUrlProtocol(hostUrl)

		const url = new URL(hostUrl)
		if (fountProtocolUrl && ['localhost', '127.0.0.1'].includes(url.hostname))
			return window.open(fountProtocolUrl, '_self')
	}

	const newHostUrl = await getFountHostUrl()
	if (newHostUrl) return useUrlProtocol(newHostUrl)
	showToastI18n('error', 'protocolhandler.fountNotFound')
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
}

main().catch(e => {
	Sentry.captureException(e)
	showToastI18n('error', 'protocolhandler.unknownError', { error: e })
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
})
