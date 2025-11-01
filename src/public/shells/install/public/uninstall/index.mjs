/**
 * @file install/public/uninstall/index.mjs
 * @description 卸载 shell 的客户端逻辑。
 * @namespace install.public.uninstall
 */
import { initTranslations, geti18n } from '../../../scripts/i18n.mjs'
import { onServerEvent } from '../../../scripts/server_events.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { uninstallPart as uninstallPartEndpoint } from '../src/endpoints.mjs'

applyTheme()

/**
 * @function getURLParams
 * @memberof install.public.uninstall
 * @description 获取 URL 参数。
 * @returns {URLSearchParams} - URL 参数。
 */
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

/**
 * @function uninstallPart
 * @memberof install.public.uninstall
 * @description 卸载部件。
 * @param {string} type - 部件类型。
 * @param {string} name - 部件名称。
 * @returns {Promise<any>} - 响应数据。
 */
async function uninstallPart(type, name) {
	// Renamed imported function to avoid conflict with this local function
	const response = await uninstallPartEndpoint(type, name)

	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || geti18n('uninstall.alerts.httpError', { status: response.status }))
	}

	return await response.json()
}

/**
 * @function showMessage
 * @memberof install.public.uninstall
 * @description 显示消息。
 * @param {'info' | 'error'} type - 消息类型。
 * @param {string} message - 消息内容。
 */
function showMessage(type, message) {
	const messageElement = document.getElementById('message-content')
	const infoMessage = document.getElementById('info-message')
	const errorElement = document.getElementById('error-content')
	const errorMessage = document.getElementById('error-message')
	if (type === 'info') {
		messageElement.textContent = message
		infoMessage.style.display = 'flex'
		errorMessage.style.display = 'none'
	}
	else if (type === 'error') {
		errorElement.textContent = message
		errorMessage.style.display = 'flex'
		infoMessage.style.display = 'none'
	}
}
/**
 * @function hideMessage
 * @memberof install.public.uninstall
 * @description 隐藏消息。
 */
function hideMessage() {
	document.getElementById('info-message').style.display = 'none'
	document.getElementById('error-message').style.display = 'none'
}

await initTranslations('uninstall')
const urlParams = getURLParams()
const type = urlParams.get('type')
const name = urlParams.get('name')
const uninstallMessage = document.getElementById('uninstall-message')
const title = document.getElementById('title')
const confirmButton = document.getElementById('confirm-uninstall')
const cancelButton = document.getElementById('cancel-uninstall')

if (type && name) {
	title.textContent = geti18n('uninstall.titleWithName', { type, name })
	uninstallMessage.textContent = geti18n('uninstall.confirmMessage', { type, name })

	confirmButton.addEventListener('click', async () => {
		hideMessage()
		try {
			await uninstallPart(type, name)
		}
		catch (error) {
			showMessage('error', geti18n('uninstall.alerts.failed', { error: error.message }))
		}
	})

	// Listen for the uninstallation event to update the UI.
	onServerEvent('part-uninstalled', ({ parttype, partname }) => {
		if (parttype === type && partname === name) {
			showMessage('info', geti18n('uninstall.alerts.success', { type, name }))
			confirmButton.disabled = true
			cancelButton.dataset.i18n = 'uninstall.buttons.back'
		}
	})

	// Listen for a re-installation event to restore the UI.
	onServerEvent('part-installed', ({ parttype, partname }) => {
		if (parttype === type && partname === name) {
			confirmButton.disabled = false
			cancelButton.dataset.i18n = 'uninstall.buttons.cancel'
			hideMessage()
		}
	})
}
else {
	title.dataset.i18n = 'uninstall.invalidParamsTitle'
	showMessage('error', geti18n('uninstall.alerts.invalidParams'))
}
