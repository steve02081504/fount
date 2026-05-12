import { getChatListForUi } from '../endpoints.mjs'

const switcherContainer = document.getElementById('chat-switcher-list')
const switcherSection = document.getElementById('chat-switcher-section')

let chatList = []

/**
 * 从地址栏 hash 读取当前选中的会话 id。
 * @returns {string|null} 无 hash 时为 null
 */
function getCurrentChatId() {
	const h = (window.location.hash || '').replace(/^#/u, '')
	if (h.startsWith('group:')) {
		const rest = h.slice('group:'.length)
		const i = rest.indexOf(':')
		return i === -1 ? rest : rest.slice(0, i)
	}
	return h || null
}

/**
 * HTML 转义，用于插入模板字符串。
 * @param {unknown} text 原始文本
 * @returns {string} 可安全插入 HTML 的字符串
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

/**
 * 渲染一条会话列表项。
 * @param {Record<string, unknown>} chat 列表项（须含 `groupId`）
 * @returns {HTMLLIElement} 列表项节点
 */
function renderChatItem(chat) {
	const currentId = getCurrentChatId()?.replace(/^group:/u, '').split(':')[0] || null
	const id = chat.groupId
	const isActive = id === currentId
	const title = escapeHtml(chat.displayTitle || chat.groupTitle || chat.chars?.join(', ') || id)
	const subtitle = escapeHtml(chat.groupDescription || chat.chars?.join(', ') || '')
	const ch = escapeHtml(chat.defaultChannelId || 'default')

	const li = document.createElement('li')
	li.className = isActive ? 'rounded-lg bg-base-300' : ''
	li.dataset.groupId = id

	li.innerHTML = `
		<a href="/parts/shells:chat/hub/#group:${id}:${ch}" class="flex flex-col gap-0.5 py-2 px-3 rounded-lg hover:bg-base-300 transition-colors ${isActive ? 'pointer-events-none opacity-70' : ''}">
			<span class="font-medium text-sm truncate">${title}</span>
			${subtitle ? `<span class="text-xs opacity-60 truncate">${subtitle}</span>` : ''}
		</a>
	`

	return li
}

/**
 * 将 `chatList` 渲染进 DOM。
 * @returns {void}
 */
function renderList() {
	if (!switcherContainer) return
	switcherContainer.innerHTML = ''
	for (const chat of chatList)
		switcherContainer.appendChild(renderChatItem(chat))
}

/**
 * 拉取列表并渲染聊天切换器。
 * @returns {Promise<void>}
 */
export async function setupChatSwitcher() {
	if (!switcherSection || !switcherContainer) return

	try {
		chatList = await getChatListForUi()
		renderList()
	} catch (error) {
		console.error('Failed to load chat list for switcher:', error)
	}
}

/**
 * 在列表数据未变时仅根据当前 hash 重绘高亮。
 * @returns {void}
 */
export function refreshChatSwitcher() {
	renderList()
}
