// ==UserScript==
// @name         fount Browser Integration
// @namespace    http://tampermonkey.net/
// @version      0.0.0.0
// @description  Allows fount characters to interact with the web page.
// @author       steve02081504
// @icon         https://steve02081504.github.io/fount/imgs/icon.svg
// @match        *://*/*
// @connect      esm.sh
// @connect      github.com
// @connect      cdn.jsdelivr.net
// @connect      steve02081504.github.io
// @connect      *
// @homepage     https://github.com/steve02081504/fount
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.xmlHttpRequest
// @grant        GM_info
// ==/UserScript==

/**
 * fount 浏览器集成用户脚本。允许 fount 角色与网页交互。
 */

/* eslint-disable curly */
/* eslint-disable no-return-assign */
// eslint-disable-next-line no-redeclare
/* global GM, GM_info */

// --- 辅助函数 ---

/**
 * GM.xmlHttpRequest 的一个包装器，模仿 fetch() API。
 * @param {string} url - 要请求的 URL。
 * @param {object} [options={}] - 请求的选项（方法、头部、数据、超时）。
 * @returns {Promise<object>} - 一个解析为 GM.xmlHttpRequest 响应对象的 Promise。
 */
function gmFetch(url, options = {}) {
	return new Promise((resolve, reject) => {
		GM.xmlHttpRequest({
			method: options.method || 'GET',
			url,
			headers: options.headers,
			data: options.data,
			timeout: options.timeout,
			onload: resolve,
			/**
			 * onerror 回调
			 * @returns {void}
			 */
			onerror: () => reject(new Error(`Request error for ${url}`)),
			/**
			 * ontimeout 回调
			 * @returns {void}
			 */
			ontimeout: () => reject(new Error(`Request to ${url} timed out`))
		})
	})
}

/**
 * 获取一个用于 JSON.stringify 的 replacer 函数，以处理循环引用。
 * @returns {function(string, any): any} - replacer 函数。
 */
const getCircularReplacer = () => {
	const seen = new WeakSet()
	return (key, value) => {
		if (value?.constructor === Object) {
			if (seen.has(value)) return '[Circular]'
			seen.add(value)
		}
		return value
	}
}

// --- i18n ---
const i18n = {
	// 默认回退翻译 (英文)
	_default: {
		browser_integration_script: {
			hostChange: {
				securityWarningTitle: '--- fount Security Warning ---',
				message: `
The current page ("\${origin}") is attempting to change your fount host address to:

"\${newHost}"

Warning: Approving this will grant the new host full control over your browser integration, potentially leading to data leaks or account compromise.
Only approve if you are sure you initiated this action (e.g., migrating your fount server).

Are you sure you want to allow this change?
`,
				uuidMismatchError: 'fount Security Error: The identifier (UUID) of host ${newHost} does not match your existing one. The operation has been cancelled.',
				verificationError: 'fount Security Error: Could not verify the new host "${newHost}". Please check if the address is correct and the service is running.'
			},
			update: {
				prompt: 'A new version of the fount browser integration script is available. Do you want to open the update page now?'
			},
			csp_warning: 'fount Warning: The current page\'s Content Security Policy (CSP) may prevent fount scripts from running correctly. Some features might not work as expected.'
		},
	},
	// 这部分将由获取到的翻译填充
	loaded: {}
}

/**
 * 使用点分隔的键从对象中检索嵌套值。
 * @param {object} obj - 要查询的对象。
 * @param {string} key - 点分隔的键（例如 'a.b.c'）。
 * @returns {any} - 如果找到则为值，否则为 undefined。
 */
function getNestedValue(obj, key) {
	const keys = key.split('.')
	let value = obj
	for (const k of keys)
		if (value && value instanceof Object && k in value)
			value = value[k]
		else return undefined

	return value
}

let translationsInitialized = false
/**
 * 获取翻译字符串。
 * @param {string} key - 翻译键。
 * @param {object} [params={}] - 用于替换的参数。
 * @returns {Promise<string>} - 翻译后的字符串。
 */
async function geti18n(key, params = {}) {
	const translation = await geti18n_nowarn(key, params)
	if (translation !== undefined) return translation

	console.warn(`fount userscript: Translation key "${key}" not found.`)
	return key
}

/**
 * 获取翻译字符串，不发出警告。
 * @param {string} key - 翻译键。
 * @param {object} [params={}] - 用于替换的参数。
 * @returns {string|undefined} - 翻译后的字符串，如果未找到则为 undefined。
 */
async function geti18n_nowarn(key, params = {}) {
	if (!translationsInitialized) {
		await initTranslations()
		translationsInitialized = true
	}
	let translation = getNestedValue(i18n.loaded, key) ?? getNestedValue(i18n._default, key)
	if (translation === undefined) return

	// Interpolation for links and variables
	for (const param in params)
		translation = translation?.replace?.(
			new RegExp(`\\[(?<text>.+)\\]\\(\\$\\{${param}\\}\\)`, 'g'),
			(m, text) => `<a href="${params[param]}" target="_blank" rel="noopener" class="link">${text}</a>`
		)?.replaceAll?.(`\${${param}}`, params[param])

	return translation
}

/**
 * 翻译单个元素。
 * @param {HTMLElement} element - 要翻译的元素。
 * @returns {boolean} 如果元素已更新，则返回 true。
 */
async function translateSingularElement(element) {
	let updated = false
	/**
	 * 更新元素属性的值。
	 * @param {string} attr - 属性名。
	 * @param {any} value - 新值。
	 */
	function updateValue(attr, value) {
		if (element[attr] == value) return
		element[attr] = value
		updated = true
	}
	/**
	 * 更新元素的属性。
	 * @param {string} attr - 属性名。
	 * @param {string} value - 新值。
	 */
	function updateAttribute(attr, value) {
		if (element.getAttribute(attr) == value) return
		element.setAttribute(attr, value)
		updated = true
	}
	for (const key of element.dataset.i18n.split(';').map(k => k.trim())) {
		if (key.startsWith('\'') && key.endsWith('\'')) {
			const literal_value = key.slice(1, -1)
			if (element.textContent !== literal_value) {
				element.textContent = literal_value
				updated = true
			}
		}
		else if (getNestedValue(i18n.loaded, key) ?? getNestedValue(i18n._default, key) instanceof Object) {
			const attributes = ['placeholder', 'title', 'label', 'value', 'alt', 'aria-label']
			for (const attr of attributes) {
				const specificKey = `${key}.${attr}`
				const translation = await geti18n_nowarn(specificKey, element.dataset)
				if (translation) updateAttribute(attr, translation)
			}
			const values = ['textContent', 'innerHTML']
			for (const attr of values) {
				const specificKey = `${key}.${attr}`
				const translation = await geti18n_nowarn(specificKey, element.dataset)
				if (translation) updateValue(attr, translation)
			}
			const dataset = await geti18n_nowarn(`${key}.dataset`)
			if (dataset) Object.assign(element.dataset, dataset)
			updated = true
		}
		else if (await geti18n_nowarn(key)) {
			const translation = await geti18n_nowarn(key, element.dataset)
			if (element.innerHTML !== translation) {
				element.innerHTML = translation
				updated = true
			}
		}
		if (updated) break
	}
	return updated
}

/**
 * 翻译元素及其子元素。
 * @param {HTMLElement} element - 要翻译的元素。
 * @returns {HTMLElement} 翻译后的元素。
 */
async function i18nElement(element) {
	if (element.matches?.('[data-i18n]'))
		await translateSingularElement(element)

	const elements = element.querySelectorAll('[data-i18n]')
	await Promise.all([...elements].map(el => translateSingularElement(el)))
	return element
}

/**
 * 初始化翻译。
 * @returns {Promise<void>}
 */
async function initTranslations() {
	const base_dir = 'https://steve02081504.github.io/fount'
	try {
		// Fetch available locales
		const availableLocales = []
		const listRes = await gmFetch(`${base_dir}/locales/list.csv`)
		if (listRes.status === 200) {
			const lines = listRes.responseText.split('\n').slice(1)
			for (const line of lines) {
				const [code] = line.split(',').map(item => item.trim())
				if (code) availableLocales.push(code)
			}
		} else console.warn('fount userscript: Could not fetch locales list.csv.')

		// Determine best language
		const userPreferredLangs = await GM.getValue('fount_user_preferred_locales', [])
		const browserLangs = [...navigator.languages || [navigator.language]].filter(Boolean)
		const combinedPrefs = [...new Set([...userPreferredLangs, ...browserLangs, 'en-UK'])].filter(Boolean)

		let lang = 'en-UK'
		for (const preferredLocale of combinedPrefs) {
			if (availableLocales.includes(preferredLocale)) {
				lang = preferredLocale
				break
			}
			const baseLang = preferredLocale.split('-')[0]
			const fallback = availableLocales.find(name => name.startsWith(baseLang))
			if (fallback) {
				lang = fallback
				break
			}
		}

		// Fetch translation file
		if (lang !== 'en-UK') {
			const translationResponse = await gmFetch(`${base_dir}/locales/${lang}.json`)
			if (translationResponse.status === 200) i18n.loaded = JSON.parse(translationResponse.responseText)
			else throw new Error(`Failed to fetch translations: ${translationResponse.status} ${translationResponse.statusText}`)
		} else
			i18n.loaded = {}
	} catch (error) {
		console.error('fount userscript: Error initializing translations:', error)
	}
}

const AUTORUN_SCRIPTS_KEY = 'fount_autorun_scripts'
window.addEventListener('fount-autorun-script-update', async (e) => {
	const { action, script } = e.detail
	if (!action || !script) return
	const storedScripts = await GM.getValue(AUTORUN_SCRIPTS_KEY, [])
	let updatedScripts = []
	if (action === 'add') {
		updatedScripts = storedScripts.filter(s => s.id !== script.id)
		updatedScripts.push(script)
	}
	else if (action === 'delete')
		updatedScripts = storedScripts.filter(s => s.id !== script.id)
	else return
	await GM.setValue(AUTORUN_SCRIPTS_KEY, updatedScripts)
})

const IconCache = {}

/**
 * 从 HTML 字符串安全地创建 DOM 元素（包括执行 <script> 标签和使得 <link> 标签生效），返回 DocumentFragment。
 *
 * @param {string} htmlString - 包含 HTML 代码的字符串。
 * @returns {DocumentFragment} - 渲染好的 DocumentFragment。
 */
function createDocumentFragmentFromHtmlString(htmlString) {
	if (!htmlString || !htmlString.trim()) return document.createDocumentFragment()

	const template = document.createElement('template')
	template.innerHTML = htmlString
	const fragment = template.content

	fragment.querySelectorAll('script[src^="/___"]').forEach(oldScript => {
		oldScript.remove()
	})
	fragment.querySelectorAll('script').forEach(oldScript => {
		const newScript = document.createElement('script')
		for (const attr of oldScript.attributes)
			newScript.setAttribute(attr.name, attr.value)
		if (oldScript.textContent) newScript.text = oldScript.textContent
		oldScript.parentNode.replaceChild(newScript, oldScript)
	})
	fragment.querySelectorAll('link').forEach(oldLink => {
		const newLink = document.createElement('link')
		for (const attr of oldLink.attributes)
			newLink.setAttribute(attr.name, attr.value)
		oldLink.parentNode.replaceChild(newLink, oldLink)
	})

	return fragment
}

/**
 * currentColor在img的从url导入的svg中不起作用，此函数旨在解决这个问题。
 * @param {DocumentFragmentOrElement} DOM - 要处理的 DOM。
 * @returns {Promise<DocumentFragmentOrElement>} - 处理后的 DOM。
 */
async function svgInliner(DOM) {
	const svgs = DOM.querySelectorAll('img[src$=".svg"]')
	await Promise.all([...svgs].map(async svg => {
		const url = svg.getAttribute('src')
		IconCache[url] ??= fetch(url).then(response => response.text())
		let data = IconCache[url] = await IconCache[url]
		// 对于每个id="xx"的match，在id后追加uuid
		const uuid = Math.random().toString(36).slice(2)
		const matches = data.matchAll(/id="([^"]+)"/g)
		for (const match of matches) data = data.replaceAll(match[1], `${match[1]}-${uuid}`)
		const newSvg = createDocumentFragmentFromHtmlString(data)
		for (const attr of svg.attributes)
			newSvg.querySelector('svg').setAttribute(attr.name, attr.value)
		svg.replaceWith(newSvg)
	})).catch(console.error)
	return DOM
}

// --- 全局变量与常量 ---
const BLOCK_DURATION_MS = 3600000
const INITIAL_RETRY_DELAY = 5000
const MAX_RETRY_DELAY = 300000
const RETRY_INCREMENT = 5000
let pageId = -1
let ws = null
let currentRetryDelay = INITIAL_RETRY_DELAY
let connectionTimeoutId = null
let apiKeyRefreshPromise = null
const blockedHosts = new Map()

/** @type {number} 最后一次成功刷新 API 密钥的时间戳。 */
let lastRefreshTimestamp = 0
/** @constant {number} 忽略刷新后过时 401 错误的宽限期（毫秒）。 */
const REFRESH_GRACE_PERIOD_MS = 5000

let cspWarningShown = false


// --- 主机管理与状态缓存 ---
let fountDataCache = null
/**
 * 获取存储的数据。
 * @returns {Promise<object>} - 存储的数据。
 */
async function getStoredData() {
	if (fountDataCache) return fountDataCache
	const host = await GM.getValue('fount_host', null)
	const uuid = await GM.getValue('fount_uuid', null)
	const protocol = await GM.getValue('fount_protocol', 'http:')
	const apikey = await GM.getValue('fount_apikey', null)
	return fountDataCache = { host, uuid, protocol, apikey }
}

/**
 * 设置存储的数据。
 * @param {string} host - 主机。
 * @param {string} uuid - UUID。
 * @param {string} protocol - 协议。
 * @param {string} apikey - API 密钥。
 * @returns {Promise<void>}
 */
async function setStoredData(host, uuid, protocol, apikey) {
	fountDataCache = { host, uuid, protocol, apikey }
	await GM.setValue('fount_host', host)
	await GM.setValue('fount_uuid', uuid)
	await GM.setValue('fount_protocol', protocol)
	await GM.setValue('fount_apikey', apikey)
	const previousHosts = await GM.getValue('fount_previous_hosts', [])
	const newHostEntry = { host, protocol }
	const updatedHosts = [newHostEntry, ...previousHosts.filter(p => p.host !== host)]
	await GM.setValue('fount_previous_hosts', updatedHosts.slice(0, 13))
}

// --- API Communication ---

/**
 * 发出 API 请求。
 * @param {string} host - 主机。
 * @param {string} protocol - 协议。
 * @param {string} endpoint - 端点。
 * @param {object} [options={}] - 选项。
 * @returns {Promise<any>} - API 响应。
 */
async function makeApiRequest(host, protocol, endpoint, options = {}) {
	const { method = 'GET', timeout = 3000, data: requestData, isRetry = false, authType = 'bearer' } = options
	const url = `${protocol}//${host}${endpoint}`
	const headers = { Accept: 'application/json' }

	if (authType === 'bearer') {
		const { apikey } = await getStoredData()
		if (apikey) headers.Authorization = `Bearer ${apikey}`
	}
	if (method === 'POST') headers['Content-Type'] = 'application/json'

	try {
		const response = await gmFetch(url, {
			method, timeout, headers,
			data: requestData ? JSON.stringify(requestData) : undefined
		})

		if (response.status >= 200 && response.status < 300)
			try { return response.responseText ? JSON.parse(response.responseText) : {} }
			catch (e) { throw new Error(`Failed to parse response from ${endpoint}`) }

		if (response.status === 401 && authType === 'bearer' && !isRetry) {
			const now = Date.now()
			if (now - lastRefreshTimestamp < REFRESH_GRACE_PERIOD_MS) {
				console.log(`fount userscript: Ignoring stale 401 for ${endpoint} and retrying.`)
				return makeApiRequest(host, protocol, endpoint, { ...options, isRetry: true })
			}

			console.warn(`fount userscript: Received 401 Unauthorized for ${endpoint}. Waiting for API key refresh.`)
			try {
				await refreshApiKey(host, protocol)
				return makeApiRequest(host, protocol, endpoint, { ...options, isRetry: true })
			} catch (refreshError) {
				console.error(`fount userscript: The API key refresh operation failed for ${endpoint}.`, refreshError.message)
				throw new Error(`API key refresh failed after a 401 error on ${endpoint}.`)
			}
		}
		throw new Error(`Request to ${endpoint} failed with status: ${response.status}`)
	} catch (error) {
		if (error.message.includes('Request to') || error.message.includes('Failed to parse') || error.message.includes('API key refresh failed'))
			throw error
		throw new Error(`Request error for ${endpoint}: ${error.message}`)
	}
}

/**
 * 从 fount 主机请求新的 API 密钥。
 * @param {string} host - fount 主机。
 * @param {string} protocol - 协议（http: 或 https:）。
 * @returns {Promise<string>} - 解析为新 API 密钥的 Promise。
 */
async function requestNewApiKey(host, protocol) {
	const { apiKey } = await makeApiRequest(host, protocol, '/api/apikey/create', {
		method: 'POST',
		data: { description: 'Browser Integration Userscript' },
		authType: 'session'
	})
	if (!apiKey) throw new Error('Server did not return a new API key.')
	return apiKey
}

/**
 * 刷新 API 密钥。
 * @param {string} host - 主机。
 * @param {string} protocol - 协议。
 * @returns {Promise<string>} - 新的 API 密钥。
 */
function refreshApiKey(host, protocol) {
	apiKeyRefreshPromise ??= (async () => {
		try {
			const newApiKey = await requestNewApiKey(host, protocol)
			const { uuid } = await getStoredData()
			await setStoredData(host, uuid, protocol, newApiKey)
			lastRefreshTimestamp = Date.now()
			console.log('fount userscript: Successfully refreshed and stored new API key.')
			return newApiKey
		} finally {
			apiKeyRefreshPromise = null
		}
	})()
	return apiKeyRefreshPromise
}

/**
 * Ping fount 主机。
 * @param {string} host - 主机。
 * @param {string} protocol - 协议。
 * @returns {Promise<any>} - Ping 响应。
 */
async function pingHost(host, protocol) {
	const data = await makeApiRequest(host, protocol, '/api/ping', { authType: 'session' })
	if (data.client_name === 'fount') return data
	throw new Error('Not a fount host')
}

/**
 * 获取当前用户。
 * @param {string} host - 主机。
 * @param {string} protocol - 协议。
 * @returns {Promise<any>} - 用户信息。
 */
function whoami(host, protocol) {
	return makeApiRequest(host, protocol, '/api/whoami')
}

// --- SECURE HOST CHANGE LISTENER ---
window.addEventListener('fount-host-info', async (e) => {
	const { host: newHost, protocol: newProtocol } = e.detail
	if (!newHost || !newProtocol) return
	const { host: storedHost, uuid: storedUuid } = await getStoredData()

	if (!storedHost) { // Initial Setup
		if (newHost === window.location.host)
			try {
				const pingData = await pingHost(newHost, newProtocol)
				const apiKey = await requestNewApiKey(newHost, newProtocol)
				await setStoredData(newHost, pingData.uuid, newProtocol, apiKey)
				clearTimeout(connectionTimeoutId)
				currentRetryDelay = INITIAL_RETRY_DELAY
				if (ws) ws.close()
				await loadUserLocalesFromFount()
				findAndConnect()
			} catch (error) {
				console.error(`fount userscript: Initial setup for host ${newHost} failed verification.`, error)
			}
		else
			console.warn(`fount userscript: Blocked initial host setup attempt from untrusted origin "${window.location.hostname}" for target host "${newHost}".`)

		return
	}

	if (newHost !== storedHost) { // Host Change
		if (blockedHosts.has(newHost) && (Date.now() - blockedHosts.get(newHost) < BLOCK_DURATION_MS)) return
		const origin = window.location.hostname
		const warningMessage = await geti18n('browser_integration_script.hostChange.securityWarningTitle') + '\n\n' + await geti18n('browser_integration_script.hostChange.message', { origin, newHost })
		if (window.confirm(warningMessage)) try {
			const pingData = await pingHost(newHost, newProtocol)
			if (!storedUuid || storedUuid === pingData.uuid) {
				const apiKey = await requestNewApiKey(newHost, newProtocol)
				await setStoredData(newHost, pingData.uuid, newProtocol, apiKey)
				clearTimeout(connectionTimeoutId)
				currentRetryDelay = INITIAL_RETRY_DELAY
				if (ws) ws.close()
				await loadUserLocalesFromFount()
				findAndConnect()
			} else alert(await geti18n('browser_integration_script.hostChange.uuidMismatchError', { newHost }))
		} catch (error) {
			console.error(`fount userscript: New host ${newHost} failed verification.`, error)
			alert(await geti18n('browser_integration_script.hostChange.verificationError', { newHost }))
		}
		else blockedHosts.set(newHost, Date.now())

		return
	}

	if (!ws || ws.readyState === WebSocket.CLOSED) findAndConnect()
})

// --- Toast Notifications ---

let toastContainer = null

const icons = {
	info: 'https://api.iconify.design/line-md/alert-circle.svg',
	success: 'https://api.iconify.design/line-md/confirm-circle.svg',
	warning: 'https://api.iconify.design/line-md/alert.svg',
	error: 'https://api.iconify.design/line-md/alert.svg',
}

/**
 * 确保 toast 容器存在并返回它。
 * @returns {HTMLElement} - toast 容器元素。
 */
function ensureToastContainer() {
	if (!toastContainer)
		toastContainer = document.querySelector('#fount-toast-container')

	if (!toastContainer) {
		toastContainer = document.createElement('div')
		toastContainer.id = 'fount-toast-container'
		toastContainer.className = 'fount-browserIntegration-toast fount-browserIntegration-toast-bottom fount-browserIntegration-toast-end'
		document.body.appendChild(toastContainer)
	}
	return toastContainer
}

/**
 * 支持的 toast 转义样式类。
 * @type {string[]}
 */
const supportedClasses = [
	'toast', 'toast-bottom', 'toast-end',
	'animate-fade-in-up', 'animate-fade-out-down',
	'alert', 'alert-info', 'alert-success', 'alert-warning', 'alert-error',
	'shadow-lg', 'flex', 'items-end', 'opacity-80', 'flex-none', 'w-12', 'h-12', 'mr-2',
	'h-full', 'w-full', 'aspect-square', 'flex-grow', 'text-xs', 'mb-1', 'font-bold', 'text-lg', 'text-sm',
	'h-6', 'w-6', 'flex-shrink-0',
]

/**
 * 添加 toast 样式。
 * @returns {void}
 */
function addToastStyles() {
	if (document.getElementById('fount-toast-styles')) return
	const style = document.createElement('style')
	style.id = 'fount-toast-styles'
	style.textContent = `
.fount-browserIntegration-toast {
	position: fixed;
	z-index: 2147483647;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	width: max-content;
	max-width: 90vw;
}
.fount-browserIntegration-toast-bottom { bottom: 1rem; }
.fount-browserIntegration-toast-end { right: 1rem; }
.fount-browserIntegration-alert {
	display: flex;
	align-items: start;
	padding: 1rem;
	border-radius: 0.5rem;
	background-color: #333;
	color: white;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	font-size: 0.875rem;
	line-height: 1.25rem;
	box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}
.fount-browserIntegration-alert > :where(svg) {
	color: currentColor;
	width: 1.5rem;
	height: 1.5rem;
	flex-shrink: 0;
	margin-right: 0.75rem;
}
.fount-browserIntegration-alert-info { background-color: #3B82F6; color: white; }
.fount-browserIntegration-alert-success { background-color: #22C55E; color: white; }
.fount-browserIntegration-alert-warning { background-color: #F59E0B; color: white; }
.fount-browserIntegration-alert-error { background-color: #EF4444; color: white; }

@keyframes fount-browserIntegration-animate-fade-in-up {
	from { opacity: 0; transform: translateY(20px); }
	to { opacity: 1; transform: translateY(0); }
}
.fount-browserIntegration-animate-fade-in-up {
	animation: fount-browserIntegration-animate-fade-in-up 0.3s ease-out forwards;
}
@keyframes fount-browserIntegration-animate-fade-out-down {
	from { opacity: 1; transform: translateY(0); }
	to { opacity: 0; transform: translateY(20px); }
}
.fount-browserIntegration-animate-fade-out-down {
	animation: fount-browserIntegration-animate-fade-out-down 0.3s ease-in forwards;
}
.fount-browserIntegration-shadow-lg {
	box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}
.fount-browserIntegration-flex {
	display: flex;
}
.fount-browserIntegration-items-end {
	align-items: end;
}
.fount-browserIntegration-opacity-80 {
	opacity: 0.8;
}
.fount-browserIntegration-flex-none {
	flex: none;
}
.fount-browserIntegration-flex-shrink-0 {
	flex-shrink: 0;
}
.fount-browserIntegration-w-6 {
	width: 1.5rem;
}
.fount-browserIntegration-h-6 {
	height: 1.5rem;
}
.fount-browserIntegration-w-12 {
	width: 3rem;
}
.fount-browserIntegration-h-12 {
	height: 3rem;
}
.fount-browserIntegration-mr-2 {
	margin-right: 0.5rem;
}
.fount-browserIntegration-h-full {
	height: 100%;
}
.fount-browserIntegration-w-full {
	width: 100%;
}
.fount-browserIntegration-aspect-square {
	aspect-ratio: 1 / 1;
}
.fount-browserIntegration-flex-grow {
	flex-grow: 1;
}
.fount-browserIntegration-text-xs {
	font-size: 0.75rem;
	line-height: 1rem;
}
.fount-browserIntegration-mb-1 {
	margin-bottom: 0.25rem;
}
.fount-browserIntegration-font-bold {
	font-weight: 700;
}
.fount-browserIntegration-text-lg {
	font-size: 1.125rem;
	line-height: 1.75rem;
}
.fount-browserIntegration-text-sm {
	font-size: 0.875rem;
	line-height: 1.25rem;
}
`
	document.head.appendChild(style)
}

/**
 * 显示一个基础的 toast 通知。
 * @param {string} type - toast 类型（例如 'info', 'success', 'warning', 'error'）。
 * @param {string|HTMLElement} message - 要显示的消息。
 * @param {number} [duration=4000] - toast 显示的持续时间（毫秒）。
 * @returns {Promise<HTMLElement>} - 创建的 toast 元素。
 */
async function base_showToast(type, message, duration = 4000) {
	addToastStyles()
	if (!(message instanceof HTMLElement) && !(Object(message) instanceof String)) {
		console.error(`fount userscript: showToast() called with non-string/non-HTMLElement message: ${message}`)
		message = String(message)
	}
	const container = ensureToastContainer()
	const alertId = `fount-browserIntegration-alert-${Date.now()}`
	const alertDiv = document.createElement('div')
	if (type == 'custom') {
		if (Object(message) instanceof HTMLElement)
			alertDiv.appendChild(message)
		else
			alertDiv.innerHTML = message
		alertDiv.id = alertId
	}
	else {
		alertDiv.id = alertId
		alertDiv.className = `alert alert-${type}`

		const iconUrl = icons[type] || icons.info
		const iconElement = document.createElement('img')
		iconElement.src = iconUrl
		iconElement.className = 'h-6 w-6 flex-shrink-0'

		const textElement = document.createElement('div')
		if (message instanceof HTMLElement)
			textElement.appendChild(message)
		else
			textElement.innerHTML = String(message).replace(/\n/g, '<br>')

		alertDiv.appendChild(iconElement)
		alertDiv.appendChild(textElement)
	}
	alertDiv.className += ' fade-in-up'
	const { host, protocol } = await getStoredData()
	alertDiv.innerHTML = alertDiv.innerHTML.replaceAll('href="/', `href="${protocol}://${host}/`)

	// 遍历 alertDiv 中的所有元素及其子元素的class，若在 supportedClasses 中，添加 fount-browserIntegration- 前缀
	for (const element of [alertDiv, ...alertDiv.querySelectorAll('*')])
		[...element.classList].filter(className => supportedClasses.includes(className)).forEach(className => {
			element.classList.remove(className)
			element.classList.add(`fount-browserIntegration-${className}`)
		})

	let hideTimeout

	/**
	 * 启动 toast 隐藏计时器。
	 * @returns {void}
	 */
	const startTimer = () => {
		hideTimeout = setTimeout(() => {
			alertDiv.classList.add('fount-browserIntegration-animate-fade-out-down')
			alertDiv.addEventListener('animationend', () => {
				alertDiv.remove()
				if (container && !container.hasChildNodes()) {
					container.remove()
					toastContainer = null
				}
			})
		}, duration)
	}

	/**
	 * 重置 toast 隐藏计时器。
	 * @returns {void}
	 */
	const resetTimer = () => {
		clearTimeout(hideTimeout)
		startTimer()
	}

	alertDiv.addEventListener('mouseenter', () => clearTimeout(hideTimeout))
	alertDiv.addEventListener('mouseleave', resetTimer)

	// Process i18n and SVGs within the message itself
	await i18nElement(alertDiv)
	await svgInliner(alertDiv)

	container.appendChild(alertDiv)
	startTimer()
	return alertDiv
}

/**
 * 以 fount 的原生样式和行为显示 Toast 通知。
 * @param {string} [type='info'] - toast 类型。
 * @param {string|HTMLElement} message - toast 消息。
 * @param {number} [duration=4000] - toast 持续时间。
 * @returns {Promise<void>}
 */
function showToast(type = 'info', message, duration = 4000) {
	return base_showToast(type, message, duration)
}

/**
 * 显示一个 i18n toast。
 * @param {string} [type='info'] - toast 类型。
 * @param {string} key - i18n 键。
 * @param {object} [params={}] - i18n 参数。
 * @param {number} [duration=4000] - toast 持续时间。
 * @returns {Promise<void>}
 */
async function showToastI18n(type = 'info', key, params = {}, duration = 4000) {
	const message = await geti18n(key, params)
	base_showToast(type, message, duration)
}

/**
 * 追加弹幕样式
 * @returns {void}
 */
function addDanmakuStyles() {
	if (document.getElementById('fount-danmaku-styles')) return
	const style = document.createElement('style')
	style.id = 'fount-danmaku-styles'
	style.textContent = `
.fount-danmaku-container {
	position: fixed;
	top: 0;
	left: 0;
	width: 100vw;
	height: 100vh;
	pointer-events: none;
	overflow: hidden;
	z-index: 2147483646; /* Just below toast notifications */
}

.fount-danmaku-item {
	position: absolute;
	white-space: nowrap;
	font-size: 24px; /* Default font size */
	font-weight: bold;
	color: white; /* Default color */
	text-shadow: 1px 1px 2px black, 0 0 1em black, 0 0 0.2em black; /* Outline for readability */
	animation-timing-function: linear;
	animation-fill-mode: forwards;
	pointer-events: none;
}

@keyframes fount-danmaku-move {
	from { transform: translateX(100vw); }
	to { transform: translateX(-100%); }
}
`
	document.head.appendChild(style)
}

let danmakuContainer = null

/**
 * 确保弹幕容器存在并返回它。
 * @returns {HTMLElement} - 弹幕容器元素。
 */
function ensureDanmakuContainer() {
	if (!danmakuContainer) {
		danmakuContainer = document.querySelector('#fount-danmaku-container')
	}
	if (!danmakuContainer) {
		danmakuContainer = document.createElement('div')
		danmakuContainer.id = 'fount-danmaku-container'
		danmakuContainer.className = 'fount-danmaku-container'
		document.body.appendChild(danmakuContainer)
	}
	return danmakuContainer
}

/**
 * 显示一个弹幕。
 * @param {Object} options - 弹幕选项。
 * @param {string} options.content - 弹幕内容。
 * @param {number} [options.speed=10] - 弹幕速度（像素/秒）。
 * @param {string} [options.color='white'] - 弹幕颜色。
 * @param {number} [options.fontSize=24] - 弹幕字体大小。
 * @param {number} [options.yPos] - 弹幕垂直位置（0-1）。
 * @returns {HTMLElement} - 创建的弹幕元素。
 */
function showDanmaku({ content, speed = 10, color = 'white', fontSize = 24, yPos }) {
	addDanmakuStyles()
	const container = ensureDanmakuContainer()
	const danmakuItem = document.createElement('div')
	danmakuItem.className = 'fount-danmaku-item'
	danmakuItem.innerHTML = content

	danmakuItem.style.color = color
	danmakuItem.style.fontSize = `${fontSize}px`

	// Determine vertical position
	let topPosition
	if (yPos !== undefined && yPos >= 0 && yPos <= 1) {
		topPosition = `${yPos * 100}vh`
	} else {
		// Random vertical position, avoiding overlap as much as possible (simple approach)
		// This is a very basic random placement. More advanced would track occupied lanes.
		const viewportHeight = window.innerHeight
		const danmakuHeight = fontSize + 4 // Estimate height with some padding
		const maxLanes = Math.floor(viewportHeight / danmakuHeight)
		const lane = Math.floor(Math.random() * maxLanes)
		topPosition = `${lane * danmakuHeight}px`
	}
	danmakuItem.style.top = topPosition

	danmakuItem.style.animation = `fount-danmaku-move ${speed}s linear forwards`

	danmakuItem.addEventListener('animationend', () => {
		danmakuItem.remove()
	})

	container.appendChild(danmakuItem)
}

// --- WebSocket & Core Logic ---
/**
 * 查找并连接到 fount 主机。
 * @returns {Promise<void>}
 */
async function findAndConnect() {
	if (ws) return
	const { host: storedHost, protocol: storedProtocol } = await getStoredData()
	const uniqueHosts = Array.from(new Map([
		{ host: storedHost, protocol: storedProtocol },
		...await GM.getValue('fount_previous_hosts', [])
	].filter(item => item.host).map(item => [item.host, item])).values())

	if (!uniqueHosts.length) return

	for (const { host, protocol } of uniqueHosts) try {
		const { username } = await whoami(host, protocol)
		const { apikey: storedApiKey, uuid: storedUuid } = await getStoredData()
		if (host !== storedHost) await setStoredData(host, storedUuid, protocol, storedApiKey)
		await connect(host, protocol, username, storedApiKey)
		await checkAndUnlockGitHubStarAchievement()
		try {
			const scriptUrl = `${protocol}//${host}/shells/browserIntegration/public/script.user.js`
			const response = await gmFetch(scriptUrl, {
				headers: {
					Authorization: `Bearer ${await GM.getValue('fount_apikey', null)}`
				}
			})
			if (response.status !== 200) return
			const remoteVersion = response.responseText.match(/@version\s+(\S+)/)?.[1]
			if (remoteVersion && remoteVersion !== GM_info.script.version)
				if (window.confirm(await geti18n('browser_integration_script.update.prompt')))
					window.open(scriptUrl, '_blank')
		} catch (error) {
			console.error('fount userscript: Failed to check for updates.', error)
		}
		return
	} catch (error) {
		console.warn(`fount userscript: Failed to connect to ${host}. Trying next...`, error.message)
	}

	console.error('fount userscript: All known hosts failed to connect. Retrying after backoff period.')
	connectionTimeoutId = setTimeout(findAndConnect, currentRetryDelay)
	currentRetryDelay = Math.min(currentRetryDelay + RETRY_INCREMENT, MAX_RETRY_DELAY)
}

/**
 * 连接到 WebSocket。
 * @param {string} host - 主机。
 * @param {string} protocol - 协议。
 * @param {string} username - 用户名。
 * @param {string} apikey - API 密钥。
 */
function connect(host, protocol, username, apikey) {
	if (ws) return
	return new Promise((resolve, reject) => {
		const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
		ws = new WebSocket(`${wsProtocol}//${host}/ws/shells/browserIntegration/page`, apikey)
		/**
		 * WebSocket 'open' 事件处理程序。
		 * @param {Event} event - WebSocket 打开事件。
		 * @returns {void}
		 */
		ws.onopen = async () => {
			currentRetryDelay = INITIAL_RETRY_DELAY
			ws.send(JSON.stringify({ type: 'init', payload: { url: window.location.href, title: document.title, username } }))
			resolve()
		}
		/**
		 * WebSocket 'message' 事件处理程序。
		 * @param {MessageEvent} event - WebSocket 消息事件。
		 * @returns {Promise<void>}
		 */
		ws.onmessage = async (event) => {
			resolve()
			const msg = JSON.parse(event.data)
			if (msg.type === 'init_success') {
				pageId = msg.payload.pageId
				return
			}

			if (msg.type === 'page-event-show-toast' && msg.data) {
				const { host: fountHost } = await getStoredData()
				if (window.location.host === fountHost) return sendResponse(msg.requestId, { success: true })

				const { type, message, duration } = msg.data
				showToast(type, message, duration)

				return sendResponse(msg.requestId, { success: true })
			}

			if (msg.requestId) handleCommand(msg)
		}
		/**
		 * WebSocket 'close' 事件处理程序。
		 * @returns {void}
		 */
		ws.onclose = () => {
			ws = null
			pageId = null
			connectionTimeoutId = setTimeout(findAndConnect, currentRetryDelay)
			currentRetryDelay = Math.min(currentRetryDelay + RETRY_INCREMENT, MAX_RETRY_DELAY)
		}
		/**
		 * WebSocket 'error' 事件处理程序。
		 * @param {Event} err - WebSocket 错误事件。
		 * @returns {void}
		 */
		ws.onerror = (err) => { console.error('fount userscript: WebSocket error.', err); reject(err) }
	})
}

/**
 * 检查 CSP 并发出警告。
 * @returns {Promise<void>} 一个不返回任何值的 Promise。
 */
async function checkCspAndWarn() {
	if (cspWarningShown) return

	try {
		const policy = window.trustedTypes?.createPolicy?.('fount-userscript-policy', {
			/**
			* @param {string} s - 要创建脚本的字符串。
			* @returns {string} 创建的脚本字符串。
			*/
			createScript: s => s
		}) ?? {
			/**
			* @param {string} s - 要创建脚本的字符串。
			* @returns {string} 创建的脚本字符串。
			*/
			createScript: s => s
		}

		// eslint-disable-next-line no-eval
		eval(policy.createScript('1'))
	}
	catch (e) {
		if (e.message.includes('Content Security Policy')) {
			cspWarningShown = true // Set flag immediately to prevent race conditions
			alert(await geti18n('browser_integration_script.csp_warning'))
		}
	}
}

/**
 * 处理来自 WebSocket 的命令。
 * @param {object} msg - WebSocket 消息。
 * @returns {Promise<void>}
 */
async function handleCommand(msg) {
	let payload
	try {
		switch (msg.type) {
			case 'get_full_html':
				payload = { html: document.documentElement.outerHTML }
				break
			case 'get_visible_html':
				payload = { html: getVisibleElementsHtml() }
				break
			case 'run_js': {
				await checkCspAndWarn()
				const { script, callbackInfo } = msg.payload
				let callback = null
				if (callbackInfo)
					/**
					 * @param {any} data - 回调数据。
					 */
					callback = async (data) => {
						const { host, protocol } = await getStoredData()
						if (!host) return
						try { await makeApiRequest(host, protocol, '/api/shells/browserIntegration/callback', { method: 'POST', data: { ...callbackInfo, data, pageId, script } }) }
						catch (error) { console.error('fount userscript: Error sending callback.', error) }
					}

				const { async_eval } = await import('https://esm.sh/@steve02081504/async-eval')
				const evalResult = await async_eval(script, { callback })
				payload = { result: JSON.parse(JSON.stringify(evalResult.result, getCircularReplacer())) }
				break
			}
			case 'danmaku': {
				showDanmaku(msg.payload)
				payload = { success: true }
				break
			}
			default: throw new Error(`Unknown command type: ${msg.type}`)
		}
		sendResponse(msg.requestId, payload)
	}
	catch (error) {
		sendResponse(msg.requestId, { error: error.message, stack: error.stack }, true)
	}
}

/**
 * 向 WebSocket 发送响应。
 * @param {string} requestId - 请求 ID。
 * @param {any} payload - 响应负载。
 * @param {boolean} [isError=false] - 是否为错误。
 */
function sendResponse(requestId, payload, isError = false) {
	if (!ws || ws.readyState !== WebSocket.OPEN || pageId === -1) return
	ws.send(JSON.stringify({ type: 'response', requestId, pageId, payload, isError }))
}

/**
 * 运行匹配的脚本。
 * @returns {Promise<void>}
 */
async function runMatchingScripts() {
	const scripts = await GM.getValue(AUTORUN_SCRIPTS_KEY, [])
	if (!scripts.length) return

	await checkCspAndWarn()

	const url = window.location.href
	const { async_eval } = await import('https://esm.sh/@steve02081504/async-eval')
	for (const script of scripts) try {
		if (new RegExp(script.urlRegex).test(url)) await async_eval(script.script)
	} catch (e) { console.error(`fount userscript: Error executing auto-run script ${script.id}:`, e) }
}

/**
 * 获取可见元素的 HTML。
 * @returns {string} - 可见元素的 HTML。
 */
function getVisibleElementsHtml() {
	const visibleElements = new Set()
	const allElements = document.querySelectorAll('body, body *')
	const viewportHeight = document.documentElement.clientHeight
	const viewportWidth = document.documentElement.clientWidth
	/**
	 * @param {Element} el - 要检查的元素。
	 * @returns {boolean} 如果元素在视口中则为 true，否则为 false。
	 */
	const isElementInViewport = (el) => { const rect = el.getBoundingClientRect(); return rect.top < viewportHeight && rect.bottom > 0 && rect.left < viewportWidth && rect.right > 0 }
	/**
	 * @param {Element} el - 要检查的元素。
	 * @returns {boolean} 如果元素可见则为 true，否则为 false。
	 */
	const isElementVisible = (el) => getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
	for (const el of allElements)
		if (isElementInViewport(el) && isElementVisible(el)) {
			let parent = el.parentElement, parentIsAlreadyVisible = false
			while (parent) { if (visibleElements.has(parent)) { parentIsAlreadyVisible = true; break } parent = parent.parentElement }
			if (!parentIsAlreadyVisible) visibleElements.add(el)
		}

	return Array.from(visibleElements).map(el => el.outerHTML).join('\n')
}

/**
 * 通知焦点。
 * @returns {void}
 */
function notifyFocus() {
	if (!ws || ws.readyState !== WebSocket.OPEN || pageId === -1) return
	ws.send(JSON.stringify({ type: 'focus', payload: { pageId, hasFocus: document.hasFocus() } }))
}

/**
 * 从服务器同步脚本。
 * @returns {Promise<void>}
 */
async function syncScriptsFromServer() {
	const { host, protocol } = await getStoredData()
	if (host) try {
		const { success, scripts } = await makeApiRequest(host, protocol, '/api/shells/browserIntegration/autorun-scripts')
		if (success && Array.isArray(scripts)) await GM.setValue(AUTORUN_SCRIPTS_KEY, scripts)
		else throw new Error('Server response invalid.')
	} catch (error) {
		console.error('fount userscript: Sync failed. Using local scripts as fallback.', error.message)
	}
}

/**
 * 从 fount 加载用户区域设置。
 * @returns {Promise<void>}
 */
async function loadUserLocalesFromFount() {
	const { host, protocol } = await getStoredData()
	if (host) try {
		const { value: locales } = await makeApiRequest(host, protocol, '/api/getusersetting?key=locales')
		if (locales && Array.isArray(locales)) await GM.setValue('fount_user_preferred_locales', locales)
	} catch (error) {
		console.error('fount userscript: Could not load user locales from server.', error.message)
	}
}

// --- Initialization ---

/**
 * 检查用户是否在 GitHub 上为 fount 仓库点赞并解锁相应成就。
 * @returns {Promise<boolean>} - 如果已处理（已解锁或无需再检查），则返回 true。
 */
async function checkAndUnlockGitHubStarAchievement() {
	if (!window.location.href.startsWith('https://github.com/steve02081504/fount')) return false // Not on the right page

	const starredButton = document.querySelector('.starred-button-icon')
	if (starredButton) {
		const { host, protocol } = await getStoredData()
		if (host) try {
			await makeApiRequest(host, protocol, '/api/shells/achievements/unlock/shells/browserIntegration/star_fount', { method: 'POST' })
			console.log('fount userscript: "Star Fount" achievement unlocked or already unlocked.')

			return true // Success
		} catch (error) {
			console.error('fount userscript: Failed to unlock "Star Fount" achievement. Will retry next time.', error)
		}
	}

	return false // Not starred or no host
}

/**
 * 初始化脚本。
 * @returns {Promise<void>}
 */
async function initialize() {
	await loadUserLocalesFromFount()
	syncScriptsFromServer().then(runMatchingScripts)
	findAndConnect()
}
initialize()
window.addEventListener('focus', notifyFocus)
window.addEventListener('blur', notifyFocus)
window.addEventListener('languagechange', async () => { await initTranslations() })
