// Handle WebSocket connections from userscripts
import { randomUUID } from 'node:crypto'

import { loadShellData, saveShellData } from '../../../../server/setting_loader.mjs'

/**
 * @typedef {object} PageInfo
 * @property {number} id
 * @property {import('npm:ws').WebSocket | null} ws
 * @property {string} url
 * @property {string} title
 * @property {boolean} hasFocus
 * @property {Date} connectedAt
 * @property {Date|null} disconnectedAt
 */

const pendingRequests = new Map()
let pageIdCounter = 0

/**
 * Manages all browser pages connected via userscript for a single user.
 * Isolates pages, handles focus tracking, and proxies commands.
 */
class UserPageManager {
	constructor(username) {
		this.username = username
		/**
		 * A list of all pages (active or recently disconnected) for this user.
		 * @type {PageInfo[]}
		 */
		this.pages = []
		/**
		 * The ID of the page that currently has the browser's focus.
		 * @type {number | undefined}
		 */
		this.focusedPageId = undefined
		/**
		 * A set of WebSocket connections to the shell's UI.
		 * @type {Set<import('npm:ws').WebSocket>}
		 */
		this.uiSockets = new Set()
	}

	// --- UI Communication ---

	registerUi(ws) {
		this.uiSockets.add(ws)
		console.log(`UI WebSocket registered for ${this.username}. Total: ${this.uiSockets.size}`)

		// Send initial state
		ws.send(JSON.stringify({
			type: 'pages_update',
			payload: this.getConnectedPages()
		}))

		ws.on('close', () => {
			this.uiSockets.delete(ws)
			console.log(`UI WebSocket disconnected for ${this.username}. Total: ${this.uiSockets.size}`)
		})
	}

	broadcastUiUpdate() {
		if (this.uiSockets.size === 0) return

		const payload = {
			type: 'pages_update',
			payload: this.getConnectedPages()
		}
		const message = JSON.stringify(payload)

		for (const ws of this.uiSockets)
			if (ws.readyState === ws.OPEN)
				ws.send(message)


	}

	// --- Page Management ---

	findPageById(pageId) {
		return this.pages.find(p => p.id === pageId)
	}

	/**
	 * Adds a new page to the manager or revives a recently disconnected one.
	 * @param {import('npm:ws').WebSocket} ws The WebSocket connection object.
	 * @param {string} url The URL of the connected page.
	 * @param {string} title The title of the connected page.
	 * @returns {PageInfo} The created or revived page information object.
	 */
	addPage(ws, url, title) {
		// Deduplication logic
		const RECONNECT_THRESHOLD_MS = 10000 // 10 seconds
		const existingPage = this.pages.find(p =>
			p.ws === null &&
			p.url === url &&
			p.disconnectedAt && (Date.now() - p.disconnectedAt.getTime() < RECONNECT_THRESHOLD_MS)
		)

		let page
		if (existingPage) {
			// Revive the existing page entry
			existingPage.ws = ws
			existingPage.disconnectedAt = null
			existingPage.hasFocus = true
			if (existingPage.title !== title) existingPage.title = title
			page = existingPage
			console.log(`Userscript page re-connected for ${this.username}: ${page.id} - ${title}`)
		} else {
			// Create a new page entry
			const newPageId = pageIdCounter++
			page = {
				id: newPageId,
				ws,
				url,
				title,
				hasFocus: true, // Assume focus on init
				connectedAt: new Date(),
				disconnectedAt: null,
			}
			this.pages.push(page)
			console.log(`Userscript page registered for ${this.username}: ${page.id} - ${title}`)
		}

		this.updatePageFocus(page.id, true)
		return page
	}

	removePage(pageId) {
		const pageInfo = this.findPageById(pageId)
		if (pageInfo) {
			pageInfo.ws = null
			pageInfo.disconnectedAt = new Date()
			pageInfo.hasFocus = false

			if (this.focusedPageId === pageId)
				this.focusedPageId = undefined

			this.broadcastUiUpdate()
		}
	}

	updatePageFocus(pageId, hasFocus) {
		const previouslyFocusedPageId = this.focusedPageId

		if (hasFocus) {
			// If another page was focused, unfocus it
			if (previouslyFocusedPageId !== undefined && previouslyFocusedPageId !== pageId) {
				const prevPage = this.findPageById(previouslyFocusedPageId)
				if (prevPage) prevPage.hasFocus = false
			}
			// Set current page as focused
			const currentPage = this.findPageById(pageId)
			if (currentPage) currentPage.hasFocus = true
			this.focusedPageId = pageId
		} else {
			// If the page losing focus is the one we have on record, clear the record
			if (previouslyFocusedPageId === pageId)
				this.focusedPageId = undefined

			// Ensure the page's own state is updated
			const currentPage = this.findPageById(pageId)
			if (currentPage) currentPage.hasFocus = false
		}

		console.log(`Focus changed for ${this.username}/${pageId}: ${hasFocus}`)
		this.broadcastUiUpdate()
	}

	// --- Data Retrieval ---

	getConnectedPages() {
		return this.pages
			.filter(p => p.ws !== null)
			.map(p => ({ id: p.id, url: p.url, title: p.title, hasFocus: p.hasFocus }))
	}

	getBrowseHistory() {
		return this.pages.map(p => ({
			id: p.id,
			url: p.url,
			title: p.title,
			connectedAt: p.connectedAt,
			disconnectedAt: p.disconnectedAt,
			hasFocus: p.hasFocus,
			status: p.ws ? 'connected' : 'disconnected'
		}))
	}

	getFocusedPageInfo() {
		return this.getConnectedPages().find(p => p.hasFocus)
	}

	// --- Userscript Communication ---

	/**
	 * Sends a command to a specific page and returns a Promise that resolves with the result.
	 * @param {number} pageId The ID of the target page.
	 * @param {object} command The command object to send.
	 * @returns {Promise<any>} A promise that resolves with the payload from the userscript or rejects on error/timeout.
	 */
	sendRequest(pageId, command) {
		return new Promise((resolve, reject) => {
			const page = this.findPageById(pageId)
			if (!page || !page.ws || page.ws.readyState !== page.ws.OPEN)
				return reject(new Error('Page not connected or connection not open.'))


			const requestId = `${pageId}-${randomUUID()}`
			pendingRequests.set(requestId, { resolve, reject })

			setTimeout(() => {
				if (pendingRequests.has(requestId)) {
					pendingRequests.delete(requestId)
					reject(new Error('Request timed out after 15 seconds.'))
				}
			}, 15000)

			page.ws.send(JSON.stringify({ ...command, requestId }))
		})
	}

	// --- Cleanup ---
	/**
	 * Removes old, disconnected page entries from the `pages` list to prevent memory leaks.
	 * @param {number} maxAgeMs The maximum age in milliseconds for a disconnected entry to be kept.
	 */
	cleanupOldPages(maxAgeMs) {
		const originalCount = this.pages.length
		this.pages = this.pages.filter(p => {
			if (p.ws) return true // Keep connected
			if (!p.disconnectedAt) return false // Should not happen
			const age = Date.now() - p.disconnectedAt.getTime()
			return age < maxAgeMs
		})

		if (this.pages.length < originalCount)
			console.log(`Cleaned up ${originalCount - this.pages.length} old page entries for ${this.username}.`)
	}
}

// --- Global State ---
// Map<username, UserPageManager>
const userManagers = new Map()

export function getUserManager(username) {
	if (!userManagers.has(username))
		userManagers.set(username, new UserPageManager(username))

	return userManagers.get(username)
}

// --- Periodic Cleanup ---
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_DISCONNECT_AGE_MS = 60 * 60 * 1000 // 1 hour

setInterval(() => {
	for (const manager of userManagers.values())
		manager.cleanupOldPages(MAX_DISCONNECT_AGE_MS)
}, CLEANUP_INTERVAL_MS)

// --- Userscript WebSocket ---
export function handleConnection(ws, username) {
	let currentPageId = -1
	const manager = getUserManager(username)
	console.log(`Userscript page connecting for user ${username}...`)

	ws.on('message', message => {
		try {
			const data = JSON.parse(message.toString('utf-8'))

			switch (data.type) {
				case 'init': {
					const { url, title } = data.payload
					const page = manager.addPage(ws, url, title)
					currentPageId = page.id
					ws.send(JSON.stringify({ type: 'init_success', payload: { pageId: currentPageId } }))
					break
				}
				case 'focus': {
					const { pageId, hasFocus } = data.payload
					manager.updatePageFocus(pageId, hasFocus)
					break
				}
				case 'response': {
					const pendingRequest = pendingRequests.get(data.requestId)
					if (pendingRequest) {
						if (data.isError)
							pendingRequest.reject(new Error(data.payload.error))
						else
							pendingRequest.resolve(data.payload)

						pendingRequests.delete(data.requestId)
					}
					break
				}
				default:
					console.warn(`Unknown message type from ${username}/${currentPageId}: ${data.type}`)
			}
		} catch (e) {
			console.error(`Failed to parse message from userscript ${username}/${currentPageId}:`, e)
		}
	})

	ws.on('close', () => {
		if (currentPageId === -1) {
			console.log(`Uninitialized userscript page disconnected for ${username}.`)
			return
		}
		console.log(`Userscript page disconnected for ${username}: ${currentPageId}`)
		manager.removePage(currentPageId)
	})

	ws.on('error', error => {
		console.error(`WebSocket error for page ${username}/${currentPageId}:`, error)
		ws.close() // This will trigger the 'close' event
	})
}


// --- Exported API Functions ---

export function getBrowseHistory(username) {
	return getUserManager(username).getBrowseHistory()
}

export function getConnectedPages(username) {
	return getUserManager(username).getConnectedPages()
}

export function getFocusedPageInfo(username) {
	return getUserManager(username).getFocusedPageInfo()
}

export async function getPageHtml(username, pageId) {
	return await getUserManager(username).sendRequest(pageId, { type: 'get_full_html' })
}

export async function getVisibleHtml(username, pageId) {
	return await getUserManager(username).sendRequest(pageId, { type: 'get_visible_html' })
}

export async function runJsOnPage(username, pageId, script, callbackInfo = null) {
	return await getUserManager(username).sendRequest(pageId, { type: 'run_js', payload: { script, callbackInfo } })
}

// --- Auto-run Scripts ---

const DATA_NAME = 'autorun_scripts'

function getScriptsData(username) {
	const data = loadShellData(username, 'browserIntegration', DATA_NAME)
	if (!data.scripts)
		data.scripts = []

	return data
}

export function listAutoRunScripts(username) {
	const data = getScriptsData(username)
	return data.scripts
}

export function addAutoRunScript(username, { urlRegex, script, comment }) {
	if (!urlRegex || !script)
		throw new Error('Missing required fields for auto-run script.')

	const data = getScriptsData(username)
	const newScript = {
		id: randomUUID(),
		urlRegex,
		script,
		comment: comment || '',
		createdAt: new Date().toISOString(),
	}
	data.scripts.push(newScript)
	saveShellData(username, 'browserIntegration', DATA_NAME)
	return newScript
}

export function removeAutoRunScript(username, id) {
	const data = getScriptsData(username)
	const initialLength = data.scripts.length
	data.scripts = data.scripts.filter(s => s.id !== id)
	if (data.scripts.length === initialLength)
		return { success: false, message: 'Script not found.' }

	saveShellData(username, 'browserIntegration', DATA_NAME)
	return { success: true, message: 'Script removed.' }
}

export function updateAutoRunScript(username, id, fields) {
	const data = getScriptsData(username)
	const script = data.scripts.find(s => s.id === id)
	if (!script) return { success: false, message: 'Script not found.' }
	Object.assign(script, { ...fields, id })
	saveShellData(username, 'browserIntegration', DATA_NAME)
	return { success: true, message: 'Script updated.', script }
}
