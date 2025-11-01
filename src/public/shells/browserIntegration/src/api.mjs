// Handle WebSocket connections from userscripts
import { randomUUID } from 'node:crypto'

import { loadShellData, saveShellData } from '../../../../server/setting_loader.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'

/**
 * @typedef {object} PageInfo
 * @property {number} id - 页面 ID
 * @property {import('npm:ws').WebSocket | null} ws - WebSocket 连接
 * @property {string} url - 页面 URL
 * @property {string} title - 页面标题
 * @property {boolean} hasFocus - 页面是否获得焦点
 * @property {Date} connectedAt - 连接时间
 * @property {Date|null} disconnectedAt - 断开连接时间
 */

const pendingRequests = new Map()
let pageIdCounter = 0

/**
 * 管理单个用户通过用户脚本连接的所有浏览器页面。
 * 隔离页面、处理焦点跟踪和代理命令。
 */
class UserPageManager {
	/**
	 *
	 * @param {string} username - 用户名。
	 */
	constructor(username) {
		this.username = username
		/**
		 * 此用户的所有页面（活动或最近断开连接）的列表。
		 * @type {PageInfo[]}
		 */
		this.pages = []
		/**
		 * 当前具有浏览器焦点的页面的ID。
		 * @type {number | undefined}
		 */
		this.focusedPageId = undefined
		/**
		 * 到Shell的UI的WebSocket连接集。
		 * @type {Set<import('npm:ws').WebSocket>}
		 */
		this.uiSockets = new Set()
	}

	// --- UI Communication ---

	/**
	 *
	 * @param {import('npm:ws').WebSocket} ws - WebSocket连接。
	 */
	registerUi(ws) {
		this.uiSockets.add(ws)

		// Send initial state
		ws.send(JSON.stringify({
			type: 'pages_update',
			payload: this.getConnectedPages()
		}))

		ws.on('close', () => {
			this.uiSockets.delete(ws)
		})
	}

	/**
	 * 广播UI更新。
	 */
	broadcastUiUpdate() {
		if (!this.uiSockets.size) return

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

	/**
	 *
	 * @param {number} pageId - 页面ID。
	 * @returns {PageInfo | undefined} - 页面信息。
	 */
	findPageById(pageId) {
		return this.pages.find(p => p.id === pageId)
	}

	/**
	 * 向管理器添加一个新页面或恢复最近断开连接的页面。
	 * @param {import('npm:ws').WebSocket} ws - WebSocket连接对象。
	 * @param {string} url - 连接页面的URL。
	 * @param {string} title - 连接页面的标题。
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
		}
		else {
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
		}

		this.updatePageFocus(page.id, true)
		return page
	}

	/**
	 *
	 * @param {number} pageId - 页面ID。
	 */
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

	/**
	 *
	 * @param {number} pageId - 页面ID。
	 * @param {boolean} hasFocus - 是否有焦点。
	 */
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
		}
		else {
			// If the page losing focus is the one we have on record, clear the record
			if (previouslyFocusedPageId === pageId) this.focusedPageId = undefined

			// Ensure the page's own state is updated
			const currentPage = this.findPageById(pageId)
			if (currentPage) currentPage.hasFocus = false
		}

		this.broadcastUiUpdate()
	}

	// --- Data Retrieval ---

	/**
	 * 获取连接的页面。
	 * @returns {Array<object>} - 连接的页面列表。
	 */
	getConnectedPages() {
		return this.pages
			.filter(p => p.ws !== null)
			.map(p => ({ id: p.id, url: p.url, title: p.title, hasFocus: p.hasFocus }))
	}

	/**
	 * 获取浏览历史。
	 * @returns {Array<object>} - 浏览历史列表。
	 */
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

	/**
	 * 获取有焦点的页面信息。
	 * @returns {object | undefined} - 有焦点的页面信息。
	 */
	getFocusedPageInfo() {
		return this.getConnectedPages().find(p => p.hasFocus)
	}

	// --- Userscript Communication ---

	/**
	 * 向特定页面发送命令并返回一个Promise，该Promise将以结果解析。
	 * @param {number} pageId - 目标页面的ID。
	 * @param {object} command - 要发送的命令对象。
	 * @returns {Promise<any>} - 一个promise，它将使用来自用户脚本的有效负载来解析，或者在错误/超时时拒绝。
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
	 * 从`pages`列表中删除旧的、断开连接的页面条目，以防止内存泄漏。
	 * @param {number} maxAgeMs - 保留断开连接条目的最大年龄（以毫秒为单位）。
	 */
	cleanupOldPages(maxAgeMs) {
		this.pages = this.pages.filter(p => {
			if (p.ws) return true // Keep connected
			if (!p.disconnectedAt) return false // Should not happen
			const age = Date.now() - p.disconnectedAt.getTime()
			return age < maxAgeMs
		})
	}
}

// --- Global State ---
// Map<username, UserPageManager>
const userManagers = new Map()

/**
 * 获取用户页面管理器。
 * @param {string} username - 用户名。
 * @returns {UserPageManager} - 用户页面管理器。
 */
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
/**
 * 处理 WebSocket 连接。
 * @param {import('npm:ws').WebSocket} ws - WebSocket连接。
 * @param {string} username - 用户名。
 */
export function handleConnection(ws, username) {
	let currentPageId = -1
	const manager = getUserManager(username)

	ws.on('message', message => {
		try {
			const data = JSON.parse(message.toString('utf-8'))

			switch (data.type) {
				case 'init': {
					const { url, title } = data.payload
					const page = manager.addPage(ws, url, title)
					currentPageId = page.id
					ws.send(JSON.stringify({ type: 'init_success', payload: { pageId: currentPageId } }))
					unlockAchievement(username, 'shells', 'browserIntegration', 'install_script')
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
		}
		catch (e) {
			console.error(`Failed to parse message from userscript ${username}/${currentPageId}:`, e)
		}
	})

	ws.on('close', () => {
		if (currentPageId === -1) return
		manager.removePage(currentPageId)
	})

	ws.on('error', error => {
		console.error(`WebSocket error for page ${username}/${currentPageId}:`, error)
		ws.close() // This will trigger the 'close' event
	})
}


// --- Exported API Functions ---

/**
 * 获取浏览历史。
 * @param {string} username - 用户名。
 * @returns {Array<object>} - 浏览历史列表。
 */
export function getBrowseHistory(username) {
	return getUserManager(username).getBrowseHistory()
}

/**
 * 获取连接的页面。
 * @param {string} username - 用户名。
 * @returns {Array<object>} - 连接的页面列表。
 */
export function getConnectedPages(username) {
	return getUserManager(username).getConnectedPages()
}

/**
 * 获取有焦点的页面信息。
 * @param {string} username - 用户名。
 * @returns {object | undefined} - 有焦点的页面信息。
 */
export function getFocusedPageInfo(username) {
	return getUserManager(username).getFocusedPageInfo()
}

/**
 * 获取页面 HTML。
 * @param {string} username - 用户名。
 * @param {number} pageId - 页面ID。
 * @returns {Promise<any>} - 页面HTML。
 */
export async function getPageHtml(username, pageId) {
	return await getUserManager(username).sendRequest(pageId, { type: 'get_full_html' })
}

/**
 * 获取可见部分的 HTML。
 * @param {string} username - 用户名。
 * @param {number} pageId - 页面ID。
 * @returns {Promise<any>} - 可见部分的HTML。
 */
export async function getVisibleHtml(username, pageId) {
	return await getUserManager(username).sendRequest(pageId, { type: 'get_visible_html' })
}

/**
 * 在页面上运行 JS。
 * @param {string} username - 用户名。
 * @param {number} pageId - 页面ID。
 * @param {string} script - 脚本。
 * @param {object} callbackInfo - 回调信息。
 * @returns {Promise<any>} - 脚本执行结果。
 */
export async function runJsOnPage(username, pageId, script, callbackInfo = null) {
	unlockAchievement(username, 'shells', 'browserIntegration', 'run_js')
	return await getUserManager(username).sendRequest(pageId, { type: 'run_js', payload: { script, callbackInfo } })
}

// --- Auto-run Scripts ---

const DATA_NAME = 'autorun_scripts'

/**
 * 获取脚本数据。
 * @param {string} username - 用户名。
 * @returns {object} - 脚本数据。
 */
function getScriptsData(username) {
	const data = loadShellData(username, 'browserIntegration', DATA_NAME)
	if (!data.scripts)
		data.scripts = []

	return data
}

/**
 * 列出自动运行脚本。
 * @param {string} username - 用户名。
 * @returns {Array<object>} - 自动运行脚本列表。
 */
export function listAutoRunScripts(username) {
	const data = getScriptsData(username)
	return data.scripts
}

/**
 * 添加自动运行脚本。
 * @param {string} username - 用户名。
 * @param {object} root0 - 参数。
 * @param {string} root0.urlRegex - URL正则表达式。
 * @param {string} root0.script - 脚本。
 * @param {string} root0.comment - 注释。
 * @returns {object} - 新脚本。
 */
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

/**
 * 删除自动运行脚本。
 * @param {string} username - 用户名。
 * @param {string} id - 脚本ID。
 * @returns {object} - 删除结果。
 */
export function removeAutoRunScript(username, id) {
	const data = getScriptsData(username)
	const initialLength = data.scripts.length
	data.scripts = data.scripts.filter(s => s.id !== id)
	if (data.scripts.length === initialLength)
		return { success: false, message: 'Script not found.' }

	saveShellData(username, 'browserIntegration', DATA_NAME)
	return { success: true, message: 'Script removed.' }
}

/**
 * 更新自动运行脚本。
 * @param {string} username - 用户名。
 * @param {string} id - 脚本ID。
 * @param {object} fields - 字段。
 * @returns {object} - 更新结果。
 */
export function updateAutoRunScript(username, id, fields) {
	const data = getScriptsData(username)
	const script = data.scripts.find(s => s.id === id)
	if (!script) return { success: false, message: 'Script not found.' }
	Object.assign(script, { ...fields, id })
	saveShellData(username, 'browserIntegration', DATA_NAME)
	return { success: true, message: 'Script updated.', script }
}
