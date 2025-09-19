// Handle WebSocket connections from userscripts
import { randomUUID } from 'node:crypto'

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

class UserPageManager {
	constructor(username) {
		this.username = username
		/** @type {PageInfo[]} */
		this.pages = []
		/** @type {number | undefined} */
		this.focusedPageId = undefined
	}

	// --- Page Management ---

	findPageById(pageId) {
		return this.pages.find(p => p.id === pageId)
	}

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

function getUserManager(username) {
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
