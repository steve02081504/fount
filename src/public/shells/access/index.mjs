import qrcode from 'https://esm.run/qrcode-generator'

import {
	redirectToLoginInfo,
	retrieveAndDecryptCredentials,
	generateLoginInfoUrl,
} from '../../scripts/credentialManager.mjs'
import { hosturl_in_local_ip, ping } from '../../scripts/endpoints.mjs'
import { initTranslations } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

applyTheme()
initTranslations('access')

const accessUrl = document.getElementById('accessUrl')
const copyButton = document.getElementById('copyButton')
const qrcodeContainer = document.getElementById('qrcode')
const toast = document.getElementById('toast')

let url

try {
	const hashParams = new URLSearchParams(window.location.hash.substring(1))
	const uuid_from_hash = hashParams.get('uuid')
	const fileId = new URLSearchParams(window.location.search).get('fileId')
	const from = new URLSearchParams(window.location.search).get('from')

	let plaintextCredentials = null
	if (uuid_from_hash)
		try {
			plaintextCredentials = await retrieveAndDecryptCredentials(fileId, from, hashParams, uuid_from_hash)
		} catch (e) {
			console.error('Failed to retrieve credentials', e)
		}

	if (plaintextCredentials)
		try {
			const credentials = JSON.parse(plaintextCredentials)
			const { uuid } = await ping()
			const baseUrl = await hosturl_in_local_ip()

			url = await generateLoginInfoUrl(credentials, uuid, baseUrl)

			accessUrl.value = url
			if (url) generateQRCode(url, qrcodeContainer)
		} catch (error) {
			console.error('Error generating final access URL:', error)
			accessUrl.value = 'Error: ' + error.message
		}
	else
		redirectToLoginInfo(window.location.href)
}
catch (e) {
	console.error('Main access shell error', e)
	accessUrl.value = 'Error: ' + e.message
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
		.then(() => {
			toast.classList.remove('invisible')
			toast.classList.add('visible')
			setTimeout(() => {
				toast.classList.remove('visible')
				toast.classList.add('invisible')
			}, 2000)
		})
})
