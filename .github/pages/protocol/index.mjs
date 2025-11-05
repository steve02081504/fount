/* global urlParams */
import '../base.mjs'
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { getFountHostUrl, pingFount } from '../scripts/fountHostGetter.mjs'
import { initTranslations, geti18n } from '../scripts/i18n.mjs'
import { showToastI18n } from '../scripts/toast.mjs'

const fountProtocolUrl = urlParams.get('url')

const offlineDialog = document.getElementById('offline_dialog')
const offlineMessageElement = document.getElementById('offline_dialog_message')
const retryBtn = document.getElementById('retry_btn')

/**
 * 使用 URL 协议处理重定向。
 * @param {string} hostUrl - fount 主机 URL。
 * @returns {void}
 */
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

/**
 * 尝试连接到 fount 主机。
 * @returns {Promise<void>}
 */
async function attemptConnection() {
	const hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')
	if (hostUrl) {
		const isOnline = await pingFount(hostUrl)
		if (isOnline) return useUrlProtocol(hostUrl)

		offlineMessageElement.textContent = geti18n('protocolhandler.offline_dialog.message', { hostUrl })
		offlineDialog.showModal()

		/**
		 * 点击重试按钮时的处理函数。
		 * @returns {void}
		 */
		retryBtn.onclick = () => {
			offlineDialog.close()
			attemptConnection()
		}
		return
	}

	const newHostUrl = await getFountHostUrl()
	if (newHostUrl) return useUrlProtocol(newHostUrl)
	showToastI18n('error', 'protocolhandler.fountNotFound')
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
}

/**
 * 主函数，初始化翻译并尝试连接。
 * @returns {Promise<void>}
 */
async function main() {
	await initTranslations('protocolhandler')
	await attemptConnection()
}

main().catch(e => {
	Sentry.captureException(e)
	showToastI18n('error', 'protocolhandler.unknownError', { error: e })
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
})
