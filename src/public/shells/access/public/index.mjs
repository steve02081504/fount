import qrcode from 'https://esm.sh/qrcode-generator'

import {
	redirectToLoginInfo,
	retrieveAndDecryptCredentials,
	generateLoginInfoUrl,
} from '../../scripts/credentialManager.mjs'
import { hosturl_in_local_ip, ping } from '../../scripts/endpoints.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

applyTheme()
await initTranslations('access')

const accessUrl = document.getElementById('accessUrl')
const copyButton = document.getElementById('copyButton')
const qrcodeContainer = document.getElementById('qrcode')

let url

try {
	const searchParams = new URLSearchParams(window.location.search)
	const hashParams = new URLSearchParams(window.location.hash.substring(1))

	const login_status = searchParams.get('login_status')
	if (login_status === 'failed') {
		const reason = searchParams.get('reason')
		showToast(reason || 'Credential transfer failed.', 'error')
	}

	const uuid_from_hash = hashParams.get('uuid')
	const fileId = searchParams.get('fileId')
	const from = searchParams.get('from')

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
	else if (uuid_from_hash)
		throw new Error('Failed to retrieve/decrypt credentials from transfer.')
	else
		await redirectToLoginInfo(window.location.href)
} catch (e) {
	console.error(e.message)
	showToast(e.message, 'error')
	url = await hosturl_in_local_ip().catch(() => e.message) // Fallback to a default URL
}

accessUrl.value = url
if (url) {
	generateQRCode(url, qrcodeContainer)
	history.replaceState({}, document.title, window.location.pathname)
}

function generateQRCode(url, container) {
	container.innerHTML = ''
	const qr = qrcode(0, 'Q')
	qr.addData(url)
	qr.make()

	const imgTag = qr.createImgTag(6)
	container.innerHTML = imgTag
}

copyButton.addEventListener('click', () => {
	navigator.clipboard.writeText(url)
		.then(() => showToast(geti18n('access.copied'), 'success'))
		.catch(e => showToast(e.message, 'error'))
})
