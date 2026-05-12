import { getChatListForUi } from '../endpoints.mjs'

const switcherContainer = document.getElementById('chat-switcher-list')
const switcherSection = document.getElementById('chat-switcher-section')

let chatList = []

function getCurrentChatId() {
	return window.location.hash.substring(1) || null
}

function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

function renderChatItem(chat) {
	const currentId = getCurrentChatId()
	const isActive = chat.chatid === currentId
	const title = escapeHtml(chat.displayTitle || chat.groupTitle || chat.chars?.join(', ') || chat.chatid)
	const subtitle = escapeHtml(chat.groupDescription || chat.chars?.join(', ') || '')

	const li = document.createElement('li')
	li.className = isActive ? 'rounded-lg bg-base-300' : ''
	li.dataset.chatid = chat.chatid

	li.innerHTML = `
		<a href="/parts/shells:chat/#${chat.chatid}" class="flex flex-col gap-0.5 py-2 px-3 rounded-lg hover:bg-base-300 transition-colors ${isActive ? 'pointer-events-none opacity-70' : ''}">
			<span class="font-medium text-sm truncate">${title}</span>
			${subtitle ? `<span class="text-xs opacity-60 truncate">${subtitle}</span>` : ''}
		</a>
	`

	return li
}

function renderList() {
	if (!switcherContainer) return
	switcherContainer.innerHTML = ''
	for (const chat of chatList)
		switcherContainer.appendChild(renderChatItem(chat))
}

export async function setupChatSwitcher() {
	if (!switcherSection || !switcherContainer) return

	try {
		chatList = await getChatListForUi()
		renderList()
	} catch (error) {
		console.error('Failed to load chat list for switcher:', error)
	}
}

export function refreshChatSwitcher() {
	renderList()
}
