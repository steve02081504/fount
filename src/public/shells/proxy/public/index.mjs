import { geti18n, initTranslations, console } from '/scripts/i18n.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { showToast } from '/scripts/toast.mjs'

applyTheme()
usingTemplates('/shells/proxy/templates')
await initTranslations('proxy')

const fountHost = window.location.origin
const apiUrl = `${fountHost}/api/shells/proxy/calling/openai`

const proxyApiUrlInput = document.getElementById('proxyApiUrl')
const copyProxyButton = document.getElementById('copyProxyButton')
const apiKeySection = document.getElementById('apiKeySection')
const proxyApiUrlQueryInput = document.getElementById('proxyApiUrlQuery')
const copyProxyQueryButton = document.getElementById('copyProxyQueryButton')
const exampleUrl = document.getElementById('exampleUrl')

let apiKey = localStorage.getItem('proxy-apikey')

async function checkApiKey() {
	if (!apiKey) return renderApiKey()

	const response = await fetch('/api/apikey/verify', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ apiKey }),
	})
	if (!response.ok) throw new Error('Failed to verify API key')
	const data = await response.json()
	if (!data.valid) {
		console.log('Stored API key is no longer valid. Clearing it.')
		localStorage.removeItem('proxy-apikey')
		apiKey = null
	}
	renderApiKey()
}

async function generateApiKey() {
	try {
		const response = await fetch('/api/apikey/create', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ description: 'Proxy Shell API Key' }),
		})
		if (!response.ok) {
			const errorData = await response.json()
			throw new Error(errorData.message || 'Failed to generate API key')
		}
		const data = await response.json()
		apiKey = data.apiKey
		localStorage.setItem('proxy-apikey', apiKey)
		renderApiKey()
	} catch (error) {
		showToast(error.message, 'error')
	}
}

async function renderApiKey() {
	apiKeySection.innerHTML = '' // Clear section
	if (apiKey) {
		const apiKeyElement = await renderTemplate('api_key_display', { apiKey })
		apiKeySection.appendChild(apiKeyElement)

		document.getElementById('copyApiKeyButton').addEventListener('click', () => {
			navigator.clipboard.writeText(apiKey)
			showToast(geti18n('proxy.apiKeyCopied'), 'success')
		})

		const apiKeyInput = document.getElementById('apiKeyInput')
		const toggleApiKeyButton = document.getElementById('toggleApiKeyButton')
		if (toggleApiKeyButton)
			toggleApiKeyButton.addEventListener('click', () => {
				apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password'
				toggleApiKeyButton.innerHTML = `<img src="https://api.iconify.design/line-md/watch${apiKeyInput.type === 'password' ? '-off' : ''}.svg" class="text-icon h-6 w-6" />`
			})

		proxyApiUrlQueryInput.value = `${apiUrl}?fount-apikey=${apiKey}`
	} else {
		const generateButtonElement = await renderTemplate('generate_api_key_button')
		apiKeySection.appendChild(generateButtonElement)

		document.getElementById('generateApiKeyButton').addEventListener('click', generateApiKey)
		proxyApiUrlQueryInput.value = ''
	}
}

proxyApiUrlInput.value = apiUrl
if (exampleUrl) exampleUrl.textContent = apiUrl

copyProxyButton.addEventListener('click', () => {
	navigator.clipboard.writeText(proxyApiUrlInput.value)
	showToast(geti18n('proxy.copied'), 'success')
})

copyProxyQueryButton.addEventListener('click', () => {
	if (proxyApiUrlQueryInput.value) {
		navigator.clipboard.writeText(proxyApiUrlQueryInput.value)
		showToast(geti18n('proxy.copied'), 'success')
	}
})

checkApiKey()
