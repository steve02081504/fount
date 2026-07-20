/**
 * 代理 shell 的客户端逻辑。
 */
import { verifyApiKey, createApiKey } from '/scripts/api/base.mjs'
import { initTranslations, console } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'
import { mountTemplate, usingTemplates } from '/scripts/features/template.mjs'
import { showToast, showToastI18n } from '/scripts/features/toast.mjs'

applyTheme()
usingTemplates('/parts/shells:proxy/templates')
await initTranslations('proxy')

const fountHost = window.location.origin
const apiUrl = `${fountHost}/api/parts/shells:proxy/calling/openai`

const proxyApiUrlInput = document.getElementById('proxyApiUrl')
const copyProxyButton = document.getElementById('copyProxyButton')
const apiKeySection = document.getElementById('apiKeySection')
const proxyApiUrlQueryInput = document.getElementById('proxyApiUrlQuery')
const copyProxyQueryButton = document.getElementById('copyProxyQueryButton')
const exampleUrl = document.getElementById('exampleUrl')

let apiKey = localStorage.getItem('proxy-apikey')

/**
 * 检查 API 密钥。
 * @returns {Promise<void>}
 */
async function checkApiKey() {
	if (!apiKey) return renderApiKey()

	const response = await verifyApiKey(apiKey)
	if (!response.ok) throw new Error('Failed to verify API key')
	const data = await response.json()
	if (!data.valid) {
		console.log('Stored API key is no longer valid. Clearing it.')
		localStorage.removeItem('proxy-apikey')
		apiKey = null
	}
	renderApiKey()
}

/**
 * 生成 API 密钥。
 * @returns {Promise<void>}
 */
async function generateApiKey() {
	try {
		const data = await createApiKey('Proxy Shell API Key')
		apiKey = data.apiKey
		localStorage.setItem('proxy-apikey', apiKey)
		renderApiKey()
	}
	catch (error) {
		showToast('error', error.message)
	}
}

/**
 * 渲染 API 密钥。
 * @returns {Promise<void>}
 */
async function renderApiKey() {
	if (apiKey) {
		await mountTemplate(apiKeySection, 'api_key_display', { apiKey })

		document.getElementById('copyApiKeyButton').addEventListener('click', () => {
			navigator.clipboard.writeText(apiKey)
			showToastI18n('success', 'proxy.apiKeyCopied')
		})

		const apiKeyInput = document.getElementById('apiKeyInput')
		const toggleApiKeyButton = document.getElementById('toggleApiKeyButton')
		if (toggleApiKeyButton)
			toggleApiKeyButton.addEventListener('click', () => {
				apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password'
				// @fetch-resource https://api.iconify.design/line-md/watch.svg
				// @fetch-resource https://api.iconify.design/line-md/watch-off.svg
				toggleApiKeyButton.innerHTML = /* html */ `<img src="https://api.iconify.design/line-md/watch${apiKeyInput.type === 'password' ? '-off' : ''}.svg" class="text-icon h-6 w-6" />`
			})

		proxyApiUrlQueryInput.value = `${apiUrl}?fount-apikey=${apiKey}`
	}
	else {
		await mountTemplate(apiKeySection, 'generate_api_key_button')

		document.getElementById('generateApiKeyButton').addEventListener('click', generateApiKey)
		proxyApiUrlQueryInput.value = ''
	}
}

proxyApiUrlInput.value = apiUrl
if (exampleUrl) exampleUrl.textContent = apiUrl

copyProxyButton.addEventListener('click', () => {
	navigator.clipboard.writeText(proxyApiUrlInput.value)
	showToastI18n('success', 'proxy.copied')
})

copyProxyQueryButton.addEventListener('click', () => {
	if (proxyApiUrlQueryInput.value) {
		navigator.clipboard.writeText(proxyApiUrlQueryInput.value)
		showToastI18n('success', 'proxy.copied')
	}
})

checkApiKey()
