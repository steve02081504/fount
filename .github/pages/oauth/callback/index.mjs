/* global urlParams */
import '../../base.mjs'
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { showToastI18n } from '../../scripts/features/toast.mjs'
import { getFountHostUrl, pingFount } from '../../scripts/fountHostGetter.mjs'
import { initTranslations, setElementI18n } from '../../scripts/i18n/index.mjs'

const CALLBACK_PATH = '/parts/shells:oauth_handler/callback'
const offlineDialog = document.getElementById('offline_dialog')
const offlineMessageElement = document.getElementById('offline_dialog_message')
const startButton = document.getElementById('start_btn')
const retryButton = document.getElementById('retry_btn')

/**
 * 带着当前 query 跳到本机 oauth_handler callback。
 * @param {string} hostUrl - fount origin。
 * @returns {void}
 */
function bounceToFount(hostUrl) {
	const dest = new URL(CALLBACK_PATH, hostUrl)
	dest.search = window.location.search
	window.location.href = dest.href
}

/**
 * 尝试连上本机 fount 并 bounce。
 * @returns {Promise<void>}
 */
async function attemptConnection() {
	const hostUrl = window.fount?.hostUrl ?? urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')
	if (hostUrl) {
		if (await pingFount(hostUrl)) return bounceToFount(hostUrl)

		setElementI18n(offlineMessageElement, 'protocolhandler.offline_dialog.message', { hostUrl })
		offlineDialog.showModal()

		const checkInterval = setInterval(async () => {
			if (!await pingFount(hostUrl)) return
			clearInterval(checkInterval)
			offlineDialog.close()
			bounceToFount(hostUrl)
		}, 1000)

		/**
		 * 关掉离线对话框并重试连接。
		 * @returns {void}
		 */
		retryButton.onclick = () => {
			offlineDialog.close()
			clearInterval(checkInterval)
			attemptConnection()
		}
		/**
		 * 关掉离线对话框并打开 fount 仓库。
		 * @returns {void}
		 */
		startButton.onclick = () => {
			offlineDialog.close()
			window.location.href = 'https://github.com/steve02081504/fount'
		}
		return
	}

	const newHostUrl = await getFountHostUrl()
	if (newHostUrl) return bounceToFount(newHostUrl)
	showToastI18n('error', 'protocolhandler.fountNotFound')
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
}

/**
 * GitHub Pages OAuth bounce 入口。
 * @returns {Promise<void>}
 */
async function main() {
	await initTranslations('oauth_handler')
	await attemptConnection()
}

main().catch(e => {
	Sentry.captureException(e)
	showToastI18n('error', 'protocolhandler.unknownError', { error: e })
	setTimeout(() => window.location.href = 'https://github.com/steve02081504/fount', 5000)
})
