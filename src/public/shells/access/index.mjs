import qrcode from 'https://esm.run/qrcode-generator'

import { hosturl_in_local_ip, whoami } from '../../scripts/endpoints.mjs'
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
	const user = await whoami()
	const username = user.username

	let password = ''
	try {
		const logins = JSON.parse(localStorage.getItem('login_infos')) || {}
		if (logins[username]) password = logins[username]
	} catch (e) {
		console.error('Could not get logins from storage', e)
	}

	const baseUrl = await hosturl_in_local_ip()

	const params = {
		theme: localStorage.getItem('theme') || 'dark',
		userPreferredLanguages: localStorage.getItem('userPreferredLanguages') || '[]'
	}
	if (password) {
		Object.assign(params, {
			username,
			password,
			autologin: 'true'
		})
		url = `${baseUrl}/login`
	} else
		url = `${baseUrl}/`
	accessUrl.value = `${url}?` + new URLSearchParams(params)
} catch (error) {
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
