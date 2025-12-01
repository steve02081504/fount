/**
 * “访问”页面的客户端逻辑，用于生成和显示用于凭证传输的 URL 和二维码。
 */
import qrcode from 'https://esm.sh/qrcode-generator'

import {
	redirectToLoginInfo,
	retrieveAndDecryptCredentials,
	generateLoginInfoUrl,
} from '../../scripts/credentialManager.mjs'
import { hosturl_in_local_ip, ping } from '../../scripts/endpoints.mjs'
import { initTranslations } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast, showToastI18n } from '../../scripts/toast.mjs'

applyTheme()
await initTranslations('access')

const accessUrl = document.getElementById('accessUrl')
const copyButton = document.getElementById('copyButton')
const qrcodeContainer = document.getElementById('qrcode')

let url

/**
 * 1. 检查 URL 参数以获取登录状态或凭证传输信息。
 * 2. 如果存在，则尝试从服务器检索和解密凭证。
 * 3. 使用解密的凭证生成一个一次性的登录 URL。
 * 4. 如果没有传输信息，则重定向以开始凭证共享过程。
 * 5. 处理过程中发生的任何错误并向用户显示通知。
 * 6. 最终，使用生成的 URL 更新页面上的输入字段和二维码。
 */
try {
	const searchParams = new URLSearchParams(window.location.search)
	const hashParams = new URLSearchParams(window.location.hash.substring(1))

	const login_status = searchParams.get('login_status')
	if (login_status === 'failed') {
		const reason = searchParams.get('reason')
		showToast('error', reason || 'Credential transfer failed.')
	}

	const uuid_from_hash = hashParams.get('uuid')
	// Get fileId and from from hash params for security (not sent to server)
	const fileId = hashParams.get('fileId')
	const from = hashParams.get('from')

	let plaintextCredentials = null
	if (uuid_from_hash) try {
		plaintextCredentials = await retrieveAndDecryptCredentials(fileId, from, hashParams, uuid_from_hash)
	} catch (e) {
		console.error('Failed to retrieve credentials', e)
	}

	if (plaintextCredentials) {
		const credentials = JSON.parse(plaintextCredentials)
		const { uuid } = await ping()
		const baseUrl = await hosturl_in_local_ip()

		url = await generateLoginInfoUrl(credentials, uuid, baseUrl)
	}
	else if (uuid_from_hash) throw new Error('Failed to retrieve/decrypt credentials from transfer.')
	else await redirectToLoginInfo(window.location.href)
}
catch (e) {
	console.error(e.message)
	showToast('error', e.message)
	url = await hosturl_in_local_ip().catch(() => e.message) // Fallback to a default URL
}

if (url) {
	accessUrl.value = url
	generateQRCode(url, qrcodeContainer)
	history.replaceState({}, document.title, window.location.pathname)
}

/**
 * 使用给定的 URL 在指定的容器元素中生成并显示一个二维码。
 * @param {string} url - 要编码到二维码中的 URL。
 * @param {HTMLElement} container - 用于显示生成二维码图像的 DOM 元素。
 */
function generateQRCode(url, container) {
	container.innerHTML = ''
	const qr = qrcode(0, 'Q')
	qr.addData(url)
	qr.make()

	const imgTag = qr.createImgTag(6)
	container.innerHTML = imgTag
	container.children[0].dataset.i18n = 'access.QRcode'
}

copyButton.addEventListener('click', () => {
	navigator.clipboard.writeText(url)
		.then(() => showToastI18n('success', 'access.copied'))
		.catch(e => showToast('error', e.message))
})
