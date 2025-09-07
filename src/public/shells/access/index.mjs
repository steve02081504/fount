import qrcode from 'https://esm.run/qrcode-generator'

import { uploadToCatbox } from '../../scripts/catbox.mjs'
import { encrypt } from '../../scripts/crypto.mjs'
import { hosturl_in_local_ip, whoami, ping } from '../../scripts/endpoints.mjs'
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
	const [{ username }, { uuid }] = await Promise.all([whoami(), ping()])

	let password = ''
	try {
		const logins = JSON.parse(localStorage.getItem('login_infos')) || {}
		if (logins[username]) password = logins[username]
	}
	catch (e) {
		console.error('Could not get logins from storage', e)
	}

	const baseUrl = await hosturl_in_local_ip()

	if (password) {
		const redirectUrl = new URL(`${baseUrl}/login`)
		redirectUrl.searchParams.set('autologin', 'true')
		redirectUrl.searchParams.set('userPreferredLanguages', localStorage.getItem('userPreferredLanguages') || '[]')
		redirectUrl.searchParams.set('theme', localStorage.getItem('theme') || 'dark')

		const loginInfoUrl = new URL('https://steve02081504.github.io/fount/login_info/')
		loginInfoUrl.searchParams.set('redirect', encodeURIComponent(redirectUrl.href))

		const encryptedData = await encrypt(JSON.stringify({ username, password }), uuid)
		const hashParams = new URLSearchParams()
		hashParams.set('uuid', uuid)

		// Try to upload to catbox
		try {
			const fileId = await uploadToCatbox(encryptedData, '1h')
			loginInfoUrl.searchParams.set('fileId', fileId)
			console.log(`Generated access URL with Catbox fileId: ${fileId}`)
		} catch (e) {
			console.warn('Catbox upload failed for access URL, falling back to URL hash.', e)
			// Fallback to URL hash
			hashParams.set('encrypted_creds', encodeURIComponent(encryptedData))
		}

		loginInfoUrl.hash = hashParams.toString()

		url = loginInfoUrl.href
	}
	else {
		const targetUrl = new URL(baseUrl)
		targetUrl.searchParams.set('theme', localStorage.getItem('theme') || 'dark')
		targetUrl.searchParams.set('userPreferredLanguages', localStorage.getItem('userPreferredLanguages') || '[]')
		url = targetUrl.href
	}
	accessUrl.value = url
}
catch (error) {
	console.error('Error getting URL for QR code:', error)
	accessUrl.value = 'Error generating access URL: ' + error.message
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

if (url) generateQRCode(url, qrcodeContainer)
