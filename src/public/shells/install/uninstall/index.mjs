import { initTranslations, geti18n } from '../../../scripts/i18n.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { uninstallPart as uninstallPartEndpoint } from '../../src/public/endpoints.mjs'

applyTheme()
// 获取 URL 参数
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

// API 请求函数
async function uninstallPart(type, name) {
	// Renamed imported function to avoid conflict with this local function
	const response = await uninstallPartEndpoint(type, name)

	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || geti18n('uninstall.alerts.httpError', { status: response.status }))
	}

	return await response.json()
}

// 显示信息
function showMessage(message, type = 'info') {
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
// 隐藏信息
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
			const result = await uninstallPart(type, name)
			showMessage(result.message || geti18n('uninstall.alerts.success', { type, name }), 'info')
			confirmButton.disabled = true // 卸载成功后禁用按钮
			cancelButton.textContent = geti18n('uninstall.buttons.back')//更改`取消`为`返回`
		} catch (error) {
			showMessage(geti18n('uninstall.alerts.failed', { error: error.message }), 'error')
		}
	})
} else {
	title.textContent = geti18n('uninstall.invalidParamsTitle')
	showMessage(geti18n('uninstall.alerts.invalidParams'), 'error')
}
