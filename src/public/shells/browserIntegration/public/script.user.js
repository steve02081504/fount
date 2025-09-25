// ==UserScript==
// @name         fount Browser Integration
// @namespace    http://tampermonkey.net/
// @version      0.0.0.0
// @description  Allows fount characters to interact with the web page.
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

/* global GM, GM_info */

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
			}
		},
		// This will be populated with fetched translations
		loaded: {}
	}
}

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

	// Simple interpolation
	for (const param in params)
		translation = translation?.replaceAll?.(`\${${param}}`, params[param])

	return translation
}

async function initTranslations() {
	const base_dir = 'https://steve02081504.github.io/fount'
	const availableLocales = []

	try {
		// Fetch available locales from list.csv
		const listRes = await new Promise((resolve, reject) => {
			GM.xmlHttpRequest({
				method: 'GET',
				url: `${base_dir}/locales/list.csv`,
				onload: resolve,
				onerror: reject,
				ontimeout: reject
			})
		})

		if (listRes.status === 200) {
			const csvText = listRes.responseText
			const lines = csvText.split('\n').slice(1) // Skip header
			for (const line of lines) {
				const [code] = line.split(',').map(item => item.trim())
				if (code)
					availableLocales.push(code)

			}
		} else
			console.warn('fount userscript: Could not fetch locales list.csv.')

		// Determine best locale
		const preferredLocales = [...navigator.languages || [navigator.language]]
		let lang = 'en-UK' // Fallback
		for (const preferredLocale of preferredLocales) {
			if (availableLocales.includes(preferredLocale)) { lang = preferredLocale; break }
			const temp = availableLocales.find(name => name.startsWith(preferredLocale.split('-')[0]))
			if (temp) { lang = temp; break }
		}

		// Fetch translation file
		if (lang !== 'en-UK') { // No need to fetch english, it's built-in
			const translationResponse = await new Promise((resolve, reject) => {
				GM.xmlHttpRequest({
					method: 'GET',
					url: `${base_dir}/locales/${lang}.json`,
					onload: resolve,
					onerror: reject,
					ontimeout: reject
				})
			})

			if (translationResponse.status === 200) {
				i18n.loaded = JSON.parse(translationResponse.responseText)
				console.log(`fount userscript: Loaded translations for ${lang}.`)
			}
			else
				throw new Error(`Failed to fetch translations: ${translationResponse.status} ${translationResponse.statusText}`)
		}
	} catch (error) {
		console.error('fount userscript: Error initializing translations:', error)
	}
}
const AUTORUN_SCRIPTS_KEY = 'fount_autorun_scripts'

window.addEventListener('fount-autorun-script-update', async (e) => {
	const { action, script } = e.detail // script is the full object {id, urlRegex, script}
	if (!action || !script) return

	console.log(`fount userscript: Received auto-run script update. Action: ${action}, ID: ${script.id}`)

	const storedScripts = await GM.getValue(AUTORUN_SCRIPTS_KEY, [])
	let updatedScripts = []

	if (action === 'add') {
		// Remove existing script with same ID to ensure update works
		updatedScripts = storedScripts.filter(s => s.id !== script.id)
		updatedScripts.push(script)
	} else if (action === 'delete')
		updatedScripts = storedScripts.filter(s => s.id !== script.id)
	else
		return // Unknown action


	await GM.setValue(AUTORUN_SCRIPTS_KEY, updatedScripts)
	console.log(`fount userscript: Updated auto-run scripts stored. Total: ${updatedScripts.length}`)
})

// --- End i18n ---

let pageId = -1
let ws = null
let currentHost = null
let connectionTimeoutId = null

// --- Security Enhancement: Cooldown for rejected hosts ---
const blockedHosts = new Map() // Stores hostname -> block timestamp
const BLOCK_DURATION_MS = 3600000 // 1 hour

// --- Retry Backoff Strategy ---
const INITIAL_RETRY_DELAY = 5000 // 5 seconds
const MAX_RETRY_DELAY = 300000 // 5 minutes
const RETRY_INCREMENT = 5000 // 5 seconds
let currentRetryDelay = INITIAL_RETRY_DELAY

// --- Host Management ---

async function getStoredData() {
	const host = await GM.getValue('fount_host', null)
	const uuid = await GM.getValue('fount_uuid', null)
	const protocol = await GM.getValue('fount_protocol', 'http:')
	const apikey = await GM.getValue('fount_apikey', null)
	return { host, uuid, protocol, apikey }
}

async function setStoredData(host, uuid, protocol, apikey) {
	await GM.setValue('fount_host', host)
	await GM.setValue('fount_uuid', uuid)
	await GM.setValue('fount_protocol', protocol)
	await GM.setValue('fount_apikey', apikey)
	console.log(`fount userscript: Stored host: ${host}, uuid: ${uuid}, protocol: ${protocol}, apikey: ${apikey ? '********' : 'none'}`)
}

// --- SECURE HOST CHANGE LISTENER ---
window.addEventListener('fount-host-info', async (e) => {
	const { host: newHost, protocol: newProtocol } = e.detail
	if (!newHost || !newProtocol) return

	const { host: storedHost, uuid: storedUuid } = await getStoredData()

	// Case 1: Initial Setup (no host is currently stored)
	if (!storedHost) {
		// CRITICAL: Only allow the fount page itself to perform the initial setup.
		// This prevents a malicious site from setting the host for the first time
		// just by having the user visit it. The user MUST visit their fount
		// instance to kick off the relationship.
		if (newHost === window.location.host) {
			console.log(`fount userscript: Performing initial setup for host: ${newHost}`)
			try {
				const pingData = await pingHost(newHost, newProtocol)
				const { username } = await whoami(newHost, newProtocol)
				const { apiKey } = await makeApiRequest(newHost, newProtocol, '/api/apikey/create', { method: 'POST', data: { description: 'Browser Integration Userscript' } })
				await setStoredData(newHost, pingData.uuid, newProtocol, apiKey)
				clearTimeout(connectionTimeoutId)
				currentRetryDelay = INITIAL_RETRY_DELAY
				if (ws) ws.close()
				findAndConnect()
			} catch (error) {
				console.error(`fount userscript: Initial setup for host ${newHost} failed verification.`, error)
			}
		}
		else
			console.warn(`fount userscript: Blocked initial host setup attempt from untrusted origin "${window.location.hostname}" for target host "${newHost}". Please visit your fount instance to perform the initial setup.`)

		return
	}

	// Case 2: Host Change Attempt (a host is stored, and the new one is different)
	if (newHost !== storedHost) {
		// UI Fatigue Prevention: Check if this host was recently rejected by the user.
		if (blockedHosts.has(newHost) && (Date.now() - blockedHosts.get(newHost) < BLOCK_DURATION_MS)) {
			console.log(`fount userscript: Ignoring host change request for recently blocked host: ${newHost}`)
			return
		}

		// User Authorization: Ask the user for explicit permission with a clear warning.
		const origin = window.location.hostname
		const warningMessage = geti18n('browser_integration_script.hostChange.securityWarningTitle') + '\n\n' +
			geti18n('browser_integration_script.hostChange.message', { origin, newHost })

		if (window.confirm(warningMessage)) {
			console.log(`fount userscript: User approved host change to ${newHost}. Verifying...`)
			try {
				const pingData = await pingHost(newHost, newProtocol)
				// The UUID check is a good secondary measure, but user confirmation is the primary defense.
				if (!storedUuid || storedUuid === pingData.uuid) {
					console.log('fount userscript: Host verification successful. Updating and reconnecting.')
					const { username } = await whoami(newHost, newProtocol)
					const { apiKey } = await makeApiRequest(newHost, newProtocol, '/api/apikey/create', { method: 'POST', data: { description: 'Browser Integration Userscript' } })
					await setStoredData(newHost, pingData.uuid, newProtocol, apiKey)
					clearTimeout(connectionTimeoutId)
					currentRetryDelay = INITIAL_RETRY_DELAY
					if (ws) ws.close()
					findAndConnect()
				}
				else
					alert(geti18n('browser_integration_script.hostChange.uuidMismatchError', { newHost }))
			} catch (error) {
				console.error(`fount userscript: New host ${newHost} failed verification.`, error)
				alert(geti18n('browser_integration_script.hostChange.verificationError', { newHost }))
			}
		} else {
			console.warn(`fount userscript: User REJECTED host change to ${newHost}. Adding to block list for 1 hour.`)
			blockedHosts.set(newHost, Date.now())
		}
		return
	}

	// Case 3: Same host broadcast (no change needed, can be used for keep-alive or re-verification)
	// This part ensures that if the script is running on the fount page itself, it can trigger a connection attempt.
	if (!ws || ws.readyState === WebSocket.CLOSED) {
		console.log('fount userscript: Received broadcast from current host. Attempting to connect/reconnect...')
		findAndConnect()
	}
})

async function makeApiRequest(host, protocol, endpoint, options = {}) {
	const { method = 'GET', timeout = 3000, data: requestData } = options
	const { apikey } = await getStoredData()

	const headers = {}

	if (apikey)
		headers['Authorization'] = `Bearer ${apikey}`


	if (method === 'POST')
		headers['Content-Type'] = 'application/json'


	return new Promise((resolve, reject) => {
		GM.xmlHttpRequest({
			method,
			url: `${protocol}//${host}${endpoint}`,
			timeout,
			headers,
			data: requestData ? JSON.stringify(requestData) : undefined,
			onload(response) {
				if (response.status >= 200 && response.status < 300)
					try {
						const data = response.responseText ? JSON.parse(response.responseText) : {}
						resolve(data)
					} catch (e) {
						reject(new Error(`Failed to parse response from ${endpoint}`))
					}
				else
					reject(new Error(`Request to ${endpoint} failed with status: ${response.status}`))
			},
			onerror() { reject(new Error(`Request error for ${endpoint}`)) },
			ontimeout() { reject(new Error(`Request to ${endpoint} timed out`)) }
		})
	})
}

async function pingHost(host, protocol) {
	const data = await makeApiRequest(host, protocol, '/api/ping')
	if (data.client_name === 'fount')
		return data
	else
		throw new Error('Not a fount host')
}

function whoami(host, protocol) {
	return makeApiRequest(host, protocol, '/api/whoami')
}

// --- WebSocket Connection ---

async function findAndConnect() {
	if (ws) return // Already connected or connecting

	const { host, protocol, apikey } = await getStoredData()
	if (!host) {
		console.log('fount userscript: No host stored. Waiting for setup from a trusted fount page.')
		return
	}

	try {
		console.log(`fount userscript: Verifying host: ${host}...`)
		await pingHost(host, protocol)
		const { username } = await whoami(host, protocol)
		connect(host, protocol, username, apikey) // Pass apikey to connect
	} catch (error) {
		console.error(`fount userscript: Host ${host} is unreachable. Retrying in ${currentRetryDelay / 1000}s.`)
		currentHost = null
		connectionTimeoutId = setTimeout(findAndConnect, currentRetryDelay)
		currentRetryDelay = Math.min(currentRetryDelay + RETRY_INCREMENT, MAX_RETRY_DELAY)
	}
}

function connect(host, protocol, username, apikey) {
	if (ws) return
	console.log(`fount userscript: Connecting to WebSocket at ${host} for user ${username}...`)
	currentHost = host

	const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
	// Use the apikey in the Sec-WebSocket-Protocol field (the second argument).
	// The server will validate this key to authenticate the connection.
	ws = new WebSocket(`${wsProtocol}//${host}/ws/shells/browserIntegration/page`, apikey)

	ws.onopen = () => {
		console.log('fount userscript: WebSocket connected.')
		currentRetryDelay = INITIAL_RETRY_DELAY
		ws.send(JSON.stringify({ type: 'init', payload: { url: window.location.href, title: document.title, username } }))
		checkForUpdate()
	}

	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data)
		if (msg.type === 'init_success') {
			pageId = msg.payload.pageId
			console.log(`fount userscript: Registered with pageId: ${pageId}`)
			return
		}
		if (msg.requestId) handleCommand(msg)
	}

	ws.onclose = () => {
		console.log(`fount userscript: WebSocket disconnected. Reconnecting in ${currentRetryDelay / 1000} seconds...`)
		ws = null
		pageId = null
		connectionTimeoutId = setTimeout(findAndConnect, currentRetryDelay)
		currentRetryDelay = Math.min(currentRetryDelay + RETRY_INCREMENT, MAX_RETRY_DELAY)
	}

	ws.onerror = (err) => {
		console.error('fount userscript: WebSocket error.', err)
	}
}

// --- Self-Update ---
async function checkForUpdate() {
	if (!currentHost) return
	const { protocol } = await getStoredData()
	const scriptUrl = `${protocol}//${currentHost}/shells/browserIntegration/public/script.user.js`
	console.log('fount userscript: Checking for updates...')

	GM.xmlHttpRequest({
		method: 'GET',
		url: scriptUrl,
		async onload(response) {
			if (response.status !== 200) return
			const remoteVersion = response.responseText.match(/@version\s+([^\s]+)/)?.[1]
			if (!remoteVersion) return

			const localVersion = GM_info.script.version

			if (remoteVersion !== localVersion) {
				console.log(`fount userscript: Source code has changed on the server. Please update from: ${scriptUrl}`)
				if (window.confirm(await geti18n('browser_integration_script.update.prompt')))
					window.open(scriptUrl, '_blank')
			}
			else
				console.log('fount userscript: Script is up to date.')
		}
	})
}

// --- Command Handling ---
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
				const { script, callbackInfo } = msg.payload
				let callback = null

				if (callbackInfo)
					callback = async (data) => {
						const { host, protocol } = await getStoredData()
						if (!host) {
							console.error('fount userscript: Cannot send callback, host not found.')
							return
						}
						try {
							const response = await makeApiRequest(host, protocol, '/api/shells/browserIntegration/callback', {
								method: 'POST',
								data: { ...callbackInfo, data, pageId, script }
							})
							console.log('fount userscript: Callback sent successfully.', response)
						} catch (error) {
							console.error('fount userscript: Error sending callback.', error)
						}
					}
				const { async_eval } = await import('https://esm.sh/@steve02081504/async-eval')
				const evalResult = await async_eval(script, { callback })
				payload = { result: JSON.parse(JSON.stringify(evalResult.result, getCircularReplacer())) }
				break
			}
			default:
				throw new Error(`Unknown command type: ${msg.type}`)
		}
		sendResponse(msg.requestId, payload)
	} catch (error) {
		console.error(`fount userscript: error handling command ${msg.type}:`, error)
		sendResponse(msg.requestId, { error: error.message, stack: error.stack }, true)
	}
}

function sendResponse(requestId, payload, isError = false) {
	if (!ws || ws.readyState !== WebSocket.OPEN || pageId === -1) return
	ws.send(JSON.stringify({ type: 'response', requestId, pageId, payload, isError }))
}

async function runMatchingScripts() {
	const scripts = await GM.getValue(AUTORUN_SCRIPTS_KEY, [])
	if (scripts.length === 0) return

	console.log(`fount userscript: Checking ${scripts.length} auto-run script(s) for this URL.`)
	const url = window.location.href
	const { async_eval } = await import('https://esm.sh/@steve02081504/async-eval')

	for (const script of scripts)
		try {
			const regex = new RegExp(script.urlRegex)
			if (regex.test(url)) {
				console.log(`fount userscript: Running script ${script.id} (${script.comment || 'No comment'})`)
				await async_eval(script.script)
			}
		} catch (e) {
			console.error(`fount userscript: Error executing auto-run script ${script.id}:`, e)
		}

}

function getVisibleElementsHtml() {
	const visibleElements = new Set()
	const allElements = document.querySelectorAll('body, body *')
	const viewportHeight = document.documentElement.clientHeight
	const viewportWidth = document.documentElement.clientWidth

	function isElementInViewport(el) {
		const rect = el.getBoundingClientRect()
		return rect.top < viewportHeight && rect.bottom > 0 && rect.left < viewportWidth && rect.right > 0
	}

	function isElementVisible(el) {
		return getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
	}

	for (const el of allElements)
		if (isElementInViewport(el) && isElementVisible(el)) {
			let parent = el.parentElement
			let parentIsAlreadyVisible = false
			while (parent) {
				if (visibleElements.has(parent)) {
					parentIsAlreadyVisible = true
					break
				}
				parent = parent.parentElement
			}
			if (!parentIsAlreadyVisible) visibleElements.add(el)
		}

	return Array.from(visibleElements).map(el => el.outerHTML).join('\n')
}

function notifyFocus() {
	if (!ws || ws.readyState !== WebSocket.OPEN || pageId === -1) return
	ws.send(JSON.stringify({ type: 'focus', payload: { pageId, hasFocus: document.hasFocus() } }))
}

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

async function syncScriptsFromServer() {
	console.log('fount userscript: Attempting to sync auto-run scripts from server...')
	const { host, protocol } = await getStoredData()
	if (!host) {
		console.log('fount userscript: Sync skipped, no host configured.')
		return // No host, can't sync
	}

	try {
		const { success, scripts } = await makeApiRequest(host, protocol, '/api/shells/browserIntegration/autorun-scripts')
		if (success && Array.isArray(scripts)) {
			await GM.setValue(AUTORUN_SCRIPTS_KEY, scripts)
			console.log(`fount userscript: Sync successful. Updated local storage with ${scripts.length} script(s).`)
		} else
			throw new Error('Server response was not successful or scripts were not an array.')

	} catch (error) {
		console.error('fount userscript: Sync failed. Using local scripts as fallback.', error.message)
		// "失败则用本地" - Do nothing, the existing local storage will be used.
	}
}

console.log('fount userscript loaded.')
async function initialize() {
	await syncScriptsFromServer()
	runMatchingScripts()
	findAndConnect()
}
initialize()

window.addEventListener('focus', notifyFocus)
window.addEventListener('blur', notifyFocus)

// --- CSP Check ---
setTimeout(async () => {
	try {
		const scriptPolicy = window.trustedTypes?.createPolicy?.('fount-userscript-policy', { createScript: (input) => input }) ?? { createScript: input => input }
		eval(scriptPolicy.createScript('1'))
	} catch (e) {
		if (e.message.includes('Content Security Policy'))
			alert(await geti18n('browser_integration_script.csp_warning'))
	}
}, 1000)
