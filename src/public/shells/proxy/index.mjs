import { whoami } from '../../scripts/endpoints.mjs'
import { initTranslations, console } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()
initTranslations('proxy')

const fountHost = window.location.origin
const username = await whoami().then(data => data.username)
const apiUrl = `${fountHost}/asuser/${username}/api/shells/proxy/calling/openai`

const proxyApiUrlInput = document.getElementById('proxyApiUrl')
const copyProxyButton = document.getElementById('copyProxyButton')
const toastProxy = document.getElementById('toastProxy')

document.getElementById('proxyCodeExample').textContent = fountHost + '/asuser/<your_fount_username>/api/shells/proxy/calling/openai/models/<your_fount_AI_source_name>'

proxyApiUrlInput.value = apiUrl

copyProxyButton.addEventListener('click', () => {
	navigator.clipboard.writeText(proxyApiUrlInput.value)
		.then(() => {
			if (toastProxy) {
				toastProxy.classList.remove('invisible')
				toastProxy.classList.add('visible')

				setTimeout(() => {
					toastProxy.classList.remove('visible')
					toastProxy.classList.add('invisible')
				}, 2000)
			}
		})
		.catch(err => {
			console.error('Failed to copy API URL: ', err)
		})
})
