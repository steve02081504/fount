// ==UserScript==
// @name         fount Browser Integration
// @namespace    http://tampermonkey.net/
// @version      0.0.0.0
//  Allows fount characters to interact with the web page.
// @author       steve02081504
// @icon         https://steve02081504.github.io/fount/imgs/icon.svg
// @match        *://*/*
// @connect      esm.sh
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

/* global GM, GM_info */

// --- Helpers ---

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
	// Default fallback translations (English)
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
		// This will be populated with fetched translations
		loaded: {}
	}
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
	if (!translationsInitialized) {
		await initTranslations()
		translationsInitialized = true
	}
	let translation = getNestedValue(i18n.loaded, key) ?? getNestedValue(i18n._default, key)
	if (translation === undefined) {
		console.warn(`fount userscript: Translation key "${key}" not found.`)
		return key
	}
	for (const param in params)
		translation = translation?.replaceAll?.(`\${${param}}`, params[param])
	return translation
}

/**
 * 初始化翻译。
 * @returns {Promise<void>}
 */
async function initTranslations() {
	const base_dir = 'https://steve02081504.github.io/fount'
	const availableLocales = []
	const userPreferredLangs = await GM.getValue('fount_user_preferred_locales', [])
	try {
		const listRes = await gmFetch(`${base_dir}/locales/list.csv`)
		if (listRes.status === 200) {
			const lines = listRes.responseText.split('\n').slice(1)
			for (const line of lines) {
				const [code] = line.split(',').map(item => item.trim())
				if (code) availableLocales.push(code)
			}
		} else console.warn('fount userscript: Could not fetch locales list.csv.')

		const preferredLocales = [...new Set([...userPreferredLangs, ...navigator.languages || [navigator.language]])].filter(Boolean)
		let lang = 'en-UK'
		for (const preferredLocale of preferredLocales) {
			if (availableLocales.includes(preferredLocale)) { lang = preferredLocale; break }
			const temp = availableLocales.find(name => name.startsWith(preferredLocale.split('-')[0]))
			if (temp) { lang = temp; break }
		}

		if (lang !== 'en-UK') {
			const translationResponse = await gmFetch(`${base_dir}/locales/${lang}.json`)
			if (translationResponse.status === 200) i18n.loaded = JSON.parse(translationResponse.responseText)
			else throw new Error(`Failed to fetch translations: ${translationResponse.status} ${translationResponse.statusText}`)
		}
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

// --- Globals & Constants ---
let pageId = -1
let ws = null
let currentHost = null
let connectionTimeoutId = null
let apiKeyRefreshPromise = null
const blockedHosts = new Map()
const BLOCK_DURATION_MS = 3600000
const INITIAL_RETRY_DELAY = 5000
const MAX_RETRY_DELAY = 300000
const RETRY_INCREMENT = 5000
let currentRetryDelay = INITIAL_RETRY_DELAY

/** @type {number} Timestamp of the last successful API key refresh. */
let lastRefreshTimestamp = 0
/** @constant {number} Grace period in milliseconds to ignore stale 401 errors after a refresh. */
const REFRESH_GRACE_PERIOD_MS = 5000

let cspWarningShown = false


// --- Host Management & State Caching ---
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
			console.log(`fount userscript: Requesting a new API key from ${host}...`)
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
		connect(host, protocol, username, storedApiKey)
		return
	} catch (error) {
		console.warn(`fount userscript: Failed to connect to ${host}. Trying next...`, error.message)
	}

	console.error('fount userscript: All known hosts failed to connect. Retrying after backoff period.')
	currentHost = null
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
	currentHost = host
	const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
	ws = new WebSocket(`${wsProtocol}//${host}/ws/shells/browserIntegration/page`, apikey)
	/**
	 * WebSocket 'open' 事件处理程序。
	 */
	ws.onopen = () => {
		currentRetryDelay = INITIAL_RETRY_DELAY
		ws.send(JSON.stringify({ type: 'init', payload: { url: window.location.href, title: document.title, username } }))
		checkForUpdate()
	}
	/**
	 * WebSocket 'message' 事件处理程序。
	 * @param {MessageEvent} event - WebSocket 消息事件。
	 */
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data)
		if (msg.type === 'init_success') { pageId = msg.payload.pageId; return }
		if (msg.requestId) handleCommand(msg)
	}
	/**
	 * WebSocket 'close' 事件处理程序。
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
	 */
	ws.onerror = (err) => { console.error('fount userscript: WebSocket error.', err) }
}

/**
 * 检查脚本更新。
 * @returns {Promise<void>}
 */
async function checkForUpdate() {
	if (!currentHost) return
	const { protocol } = await getStoredData()
	const scriptUrl = `${protocol}//${currentHost}/shells/browserIntegration/public/script.user.js`
	try {
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
 * 初始化脚本。
 * @returns {Promise<void>}
 */
async function initialize() {
	await loadUserLocalesFromFount()
	await syncScriptsFromServer()
	runMatchingScripts()
	findAndConnect()
}
initialize()
window.addEventListener('focus', notifyFocus)
window.addEventListener('blur', notifyFocus)
