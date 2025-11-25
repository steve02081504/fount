// Handle WebSocket connections from userscripts
import { randomUUID } from 'node:crypto'

import { events } from '../../../../server/events.mjs'
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
 * 管理单个用户通过用户脚本连接的所有浏览器页面，负责隔离页面、处理焦点跟踪和代理命令。
 */
class UserPageManager {
	/**
	 * 创建一个UserPageManager实例。
	 * @param {string} username - 与此管理器关联的用户名。
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
		 * 最后一个已知具有浏览器焦点的页面的ID。
		 * @type {number | undefined}
		 */
		this.lastFocusedPageId = undefined
		/**
		 * 到Shell的UI的WebSocket连接集。
		 * @type {Set<import('npm:ws').WebSocket>}
		 */
		this.uiSockets = new Set()
	}

	// --- UI Communication ---

	/**
	 * 注册一个新的UI WebSocket连接以接收更新。
	 * @param {import('npm:ws').WebSocket} ws - 要注册的WebSocket连接。
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
	 * 将当前页面状态的更新广播到所有已注册的UI连接。
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

	/**
	 * 将消息广播到所有已连接的页面。
	 * @param {object} message - 要发送的消息对象。
	 */
	broadcastToAllPages(message) {
		const payload = JSON.stringify(message)
		for (const page of this.pages)
			if (page.ws && page.ws.readyState === page.ws.OPEN) try {
				page.ws.send(payload)
			} catch (e) {
				console.error(`Failed to send message to page ${page.id}:`, e)
			}
	}

	// --- Page Management ---

	/**
	 * 按ID查找页面。
	 * @param {number} pageId - 要查找的页面的ID。
	 * @returns {PageInfo | undefined} - 找到的页面信息对象，如果未找到则为undefined。
	 */
	findPageById(pageId) {
		return this.pages.find(p => p.id === pageId)
	}

	/**
	 * 向管理器添加一个新页面或恢复最近断开连接的页面。
	 * @param {import('npm:ws').WebSocket} ws - WebSocket连接对象。
	 * @param {string} url - 连接页面的URL。
	 * @param {string} title - 连接页面的标题。
	 * @returns {PageInfo} - 创建或恢复的页面信息对象。
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
	 * 将页面标记为已断开连接。
	 * @param {number} pageId - 要移除的页面的ID。
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
	 * 更新页面的焦点状态。
	 * @param {number} pageId - 要更新的页面的ID。
	 * @param {boolean} hasFocus - 页面是否具有焦点。
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
			this.lastFocusedPageId = pageId
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
	 * 获取当前所有活动连接的页面的简化列表。
	 * @returns {Array<object>} - 一个包含活动页面信息的对象数组。
	 */
	getConnectedPages() {
		return this.pages
			.filter(p => p.ws !== null)
			.map(p => ({ id: p.id, url: p.url, title: p.title, hasFocus: p.hasFocus }))
	}

	/**
	 * 获取所有曾经连接过的页面的完整历史记录。
	 * @returns {Array<object>} - 一个包含所有页面历史信息的对象数组。
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
	 * 获取当前具有焦点的页面的信息。
	 * @returns {object | undefined} - 具有焦点的页面的信息对象，如果没有页面具有焦点则为undefined。
	 */
	getFocusedPageInfo() {
		return this.getConnectedPages().find(p => p.hasFocus)
	}

	/**
	 * 获取最新活动页面的信息，用于当没有明确指定页面时。
	 * 优先顺序：当前焦点页 > 上一个焦点页（如果仍连接） > 最新连接的页面。
	 * @returns {object | undefined} - 最新活动页面的信息对象，如果没有则为undefined。
	 */
	getMostRecentPageInfo() {
		// 1. Try the currently focused page
		const focusedPageInfo = this.getFocusedPageInfo()
		if (focusedPageInfo) return focusedPageInfo

		// 2. Try the last known focused page, if it's still connected
		if (this.lastFocusedPageId !== undefined) {
			const lastFocused = this.getConnectedPages().find(p => p.id === this.lastFocusedPageId)
			if (lastFocused) return lastFocused
		}

		// 3. Fallback: most recently connected page
		const connectedPages = this.pages.filter(p => p.ws !== null)
		if (connectedPages.length > 0) {
			connectedPages.sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())
			const mostRecentPageId = connectedPages[0].id
			return this.getConnectedPages().find(p => p.id === mostRecentPageId)
		}

		return undefined
	}

	// --- Userscript Communication ---

	/**
	 * 向特定页面发送命令并等待响应。
	 * @param {number} pageId - 目标页面的ID。
	 * @param {object} command - 要发送的命令对象。
	 * @returns {Promise<any>} - 一个Promise，成功时返回用户脚本的响应，超时或出错时拒绝。
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
	 * 清理旧的、已断开连接的页面条目以防止内存泄漏。
	 * @param {number} maxAgeMs - 保留已断开连接条目的最长时间（毫秒）。
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
 * 获取最新活动页面的信息。
 * @param {string} username - 用户名。
 * @returns {object | undefined} - 最新活动页面的信息。
 */
export function getMostRecentPageInfo(username) {
	return getUserManager(username).getMostRecentPageInfo()
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
 * 获取指定用户的自动运行脚本数据。
 * @param {string} username - 用户的名称。
 * @returns {object} - 包含自动运行脚本的对象。
 */
function getScriptsData(username) {
	const data = loadShellData(username, 'browserIntegration', DATA_NAME)
	if (!data.scripts)
		data.scripts = []

	return data
}

/**
 * 列出指定用户的所有自动运行脚本。
 * @param {string} username - 用户的名称。
 * @returns {Array<object>} - 自动运行脚本的数组。
 */
export function listAutoRunScripts(username) {
	const data = getScriptsData(username)
	return data.scripts
}

/**
 * 为指定用户添加一个新的自动运行脚本。
 * @param {string} username - 用户的名称。
 * @param {object} root0 - 脚本的详细信息。
 * @param {string} root0.urlRegex - 匹配URL的正则表达式。
 * @param {string} root0.script - 要执行的脚本。
 * @param {string} root0.comment - 脚本的注释。
 * @returns {object} - 新创建的脚本对象。
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
 * 删除指定用户的自动运行脚本。
 * @param {string} username - 用户的名称。
 * @param {string} id - 要删除的脚本的ID。
 * @returns {object} - 操作结果。
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
 * 更新指定用户的自动运行脚本。
 * @param {string} username - 用户的名称。
 * @param {string} id - 要更新的脚本的ID。
 * @param {object} fields - 要更新的字段。
 * @returns {object} - 操作结果。
 */
export function updateAutoRunScript(username, id, fields) {
	const data = getScriptsData(username)
	const script = data.scripts.find(s => s.id === id)
	if (!script) return { success: false, message: 'Script not found.' }
	Object.assign(script, { ...fields, id })
	saveShellData(username, 'browserIntegration', DATA_NAME)
	return { success: true, message: 'Script updated.', script }
}

/**
 * 发送弹幕到页面。
 * @param {string} username - 用户名。
 * @param {number} pageId - 页面ID。
 * @param {object} danmakuOptions - 弹幕选项。
 * @param {string} danmakuOptions.content - 弹幕内容。
 * @param {number} [danmakuOptions.speed=10] - 弹幕速度（像素/秒）。
 * @param {string} [danmakuOptions.color='white'] - 弹幕颜色。
 * @param {number} [danmakuOptions.fontSize=24] - 弹幕字体大小。
 * @param {number} [danmakuOptions.yPos] - 弹幕垂直位置（0-1），表示相对于视口高度的比例。
 * @returns {Promise<any>} - 弹幕发送结果。
 */
export async function sendDanmakuToPage(username, pageId, danmakuOptions) {
	const manager = getUserManager(username)
	let targetPageId = pageId

	if (targetPageId === undefined) {
		const mostRecentPage = manager.getMostRecentPageInfo()
		if (!mostRecentPage)
			throw new Error('No page specified and no page is currently available.')

		targetPageId = mostRecentPage.id
	}

	return await manager.sendRequest(targetPageId, { type: 'danmaku', payload: danmakuOptions })
}

events.on('send-event-to-user', ({ username, type, data }) => {
	const manager = userManagers.get(username)
	if (manager) manager.broadcastToAllPages({ type: `page-event-${type}`, data })
})
