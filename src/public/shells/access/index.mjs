import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()
import { initTranslations } from '../../scripts/i18n.mjs'
initTranslations('access')

import qrcode from 'https://esm.run/qrcode-generator'
const url = 'https://steve02081504.github.io/fount/'

const accessUrl = document.getElementById('accessUrl')
const copyButton = document.getElementById('copyButton')
const qrcodeContainer = document.getElementById('qrcode')
const toast = document.getElementById('toast')

accessUrl.value = url

function generateQRCode(url, container) {
	container.innerHTML = ''
	const qr = qrcode(0, 'Q')
	qr.addData(url)
	qr.make()

	const imgTag = qr.createImgTag(6)  // Increase module size for larger QR code.  Default is 4
	container.innerHTML = imgTag
}

copyButton.addEventListener('click', () => {
	navigator.clipboard.writeText(url)
		.then(() => {
			// Show toast notification
			toast.classList.remove('invisible')
			toast.classList.add('visible')

			// Hide toast after 2 seconds
			setTimeout(() => {
				toast.classList.remove('visible')
				toast.classList.add('invisible')
			}, 2000)
		})
})

generateQRCode(url, qrcodeContainer)
