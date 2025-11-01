/**
 * @file chat/public/list/index.mjs
 * @description 聊天历史列表页面的客户端逻辑。
 * @namespace chat.public.list
 */
import { initTranslations, confirmI18n, console, setLocalizeLogic, onLanguageChange } from '../../../scripts/i18n.mjs'
import { renderMarkdown, renderMarkdownAsString } from '../../../scripts/markdown.mjs'
import { makeSearchable } from '../../../scripts/search.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast, showToastI18n } from '../../../scripts/toast.mjs'

import { getChatList, getCharDetails, copyChats, exportChats, deleteChats } from './endpoints.mjs'

usingTemplates('/shells/chat/src/templates')

const chatItemDOMCache = new Map()
const chatListContainer = document.getElementById('chat-list-container')
const sortSelect = document.getElementById('sort-select')
const filterInput = document.getElementById('filter-input')
const selectAllCheckbox = document.getElementById('select-all-checkbox')
const reverseSelectButton = document.getElementById('reverse-select-button')
const deleteSelectedButton = document.getElementById('delete-selected-button')
const exportSelectedButton = document.getElementById('export-selected-button')

let fullChatList = []
let currentFilteredList = []
const selectedChats = new Set()

const CHUNK_SIZE = 7
let fullSortedList = []
let renderTimeout

/**
 * @function renderUI
 * @memberof chat.public.list
 * @description 根据当前的过滤和排序设置对聊天列表进行排序和渲染。
 * 它会重置 UI 并开始以块的形式渲染列表项。
 * @returns {Promise<void>}
 */
async function renderUI() {
	fullSortedList = [...currentFilteredList].sort((a, b) => {
		const sortValue = sortSelect.value
		const timeA = new Date(a.lastMessageTime).getTime()
		const timeB = new Date(b.lastMessageTime).getTime()
		return sortValue === 'time_asc' ? timeA - timeB : timeB - timeA
	})

	// Clear everything
	chatListContainer.innerHTML = ''
	if (renderTimeout) clearTimeout(renderTimeout)

	// Reset selection state
	selectedChats.clear()
	selectAllCheckbox.checked = false

	appendNextChunk()
}

/**
 * @function appendNextChunk
 * @memberof chat.public.list
 * @description 从排序列表中渲染并追加下一块聊天项目到容器中，以实现无限滚动。
 */
function appendNextChunk() {
	const itemsToRender = fullSortedList.slice(chatListContainer.childElementCount, chatListContainer.childElementCount + CHUNK_SIZE)

	if (!itemsToRender.length)
		return

	Promise.all(itemsToRender.map(renderChatListItem)).then(chats => {
		chatListContainer.append(...chats)
	})
}

/**
 * @function renderMarkdownPreview
 * @memberof chat.public.list
 * @description 通过将 Markdown 字符串截断为一定数量的重要节点来渲染预览。
 * 琐碎的节点（如 <br>、<script>、注释、空白）将被忽略。
 * @param {string} markdown - 输入的 Markdown 字符串。
 * @param {number} significantNodeLimit - 要保留的重要节点数量。
 * @returns {Promise<string>} - 解析为预览 HTML 字符串的 Promise。
 */
export async function renderMarkdownPreview(markdown, significantNodeLimit) {
	const trivialTags = ['BR', 'SCRIPT', 'LINK', 'STYLE', 'META']
	const previewContainer = document.createElement('div')
	let significantCount = 0

	for (const node of Array.from((await renderMarkdown(markdown)).childNodes))
		if ((significantCount +=
			node.nodeType != Node.COMMENT_NODE &&
			(node.nodeType != Node.TEXT_NODE || node.textContent.trim()) &&
			!trivialTags.includes(node.tagName)
		) > significantNodeLimit) break
		else previewContainer.appendChild(node)

	return previewContainer.innerHTML
}

/**
 * @function renderChatListItem
 * @memberof chat.public.list
 * @description 为单个聊天会话渲染 HTML 元素。
 * 它使用缓存来避免重新渲染未更改的项目。
 * @param {object} chat - 包含聊天详细信息的聊天对象。
 * @returns {Promise<HTMLElement>} - 渲染后的聊天列表项元素。
 */
async function renderChatListItem(chat) {
	if (chatItemDOMCache.has(chat.chatid)) {
		const cachedData = chatItemDOMCache.get(chat.chatid)
		if (cachedData.lastMessageTime === chat.lastMessageTime) {
			const chatElement = cachedData.element
			const selectCheckbox = chatElement.querySelector('.select-checkbox')
			selectCheckbox.checked = selectedChats.has(chat.chatid)
			return chatElement
		}
	}
	const lastMsgTime = new Date(chat.lastMessageTime).toLocaleString()
	const data = {
		...chat,
		lastMessageTime: lastMsgTime,
		lastMessageRowContent: chat.lastMessageContent,
		lastMessageContent: await renderMarkdownAsString(chat.lastMessageContent),
		avatars: await Promise.all(chat.chars.map(async charName => {
			const details = await getCharDetails(charName)
			return { name: details.info.name, url: details.info.avatar }
		})),
		renderMarkdownPreview
	}
	const chatElement = await renderTemplate('list/chat_list_view', data)
	chatElement.setAttribute('data-chatid', chat.chatid)

	// Checkbox logic
	const selectCheckbox = chatElement.querySelector('.select-checkbox')
	setLocalizeLogic(selectCheckbox, ()=>{
		selectCheckbox.setAttribute('aria-label', geti18n('chat_history.select_chat_with_chars', { chars: chat.chars.join(', ') }))
	})
	selectCheckbox.checked = selectedChats.has(chat.chatid)
	selectCheckbox.addEventListener('change', () => {
		if (selectCheckbox.checked)
			selectedChats.add(chat.chatid)
		else {
			selectedChats.delete(chat.chatid)
			selectAllCheckbox.checked = false
		}
	})

	// Button listeners
	chatElement.querySelector('.continue-button').href = `/shells/chat#${chat.chatid}`

	chatElement.querySelector('.copy-button').addEventListener('click', async () => {
		try {
			const datas = await copyChats([chat.chatid])
			if (datas[0]?.success) {
				fullChatList = await getChatList()
				filterInput.dispatchEvent(new Event('input')) // Trigger re-filter
			} else
				showToast('error', datas[0]?.message)

		} catch (error) {
			console.error('Error copying chat:', error)
			showToastI18n('error', 'chat_history.alerts.copyError')
		}
	})

	chatElement.querySelector('.export-button').addEventListener('click', async () => {
		try {
			const datas = await exportChats([chat.chatid])
			for (const data of datas) if (data.success) {
				const blob = new Blob([JSON.stringify(data.data, null, '\t')], { type: 'application/json' })
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = `chat-${chat.chatid}.json`
				a.click()
				URL.revokeObjectURL(url)
			}
			else showToast('error', data.message)
		} catch (error) {
			console.error('Error exporting chat:', error)
			showToastI18n('error', 'chat_history.alerts.exportError')
		}
	})

	chatElement.querySelector('.delete-button').addEventListener('click', async () => {
		if (confirmI18n('chat_history.confirmDeleteChat', { chars: chat.chars.join(', ') })) try {
			const data = await deleteChats([chat.chatid])
			if (data[0].success) {
				chatItemDOMCache.delete(chat.chatid)
				fullChatList = fullChatList.filter(c => c.chatid !== chat.chatid)
				chatElement.remove()
				filterInput.dispatchEvent(new Event('input'))
			} else showToast('error', data[0].message)

		} catch (error) {
			console.error('Error deleting chat:', error)
			showToastI18n('error', 'chat_history.alerts.deleteError')
		}
	})
	chatItemDOMCache.set(chat.chatid, {
		element: chatElement,
		lastMessageTime: chat.lastMessageTime,
	})
	return chatElement
}

sortSelect.addEventListener('change', renderUI)

// Bulk actions
selectAllCheckbox.addEventListener('change', () => {
	const isChecked = selectAllCheckbox.checked
	document.querySelectorAll('.chat-list-item').forEach(item => {
		const chatid = item.getAttribute('data-chatid')
		const checkbox = item.querySelector('.select-checkbox')
		checkbox.checked = isChecked
		if (isChecked) selectedChats.add(chatid)
		else selectedChats.delete(chatid)
	})
})

reverseSelectButton.addEventListener('click', () => {
	document.querySelectorAll('.chat-list-item').forEach(item => {
		const chatid = item.getAttribute('data-chatid')
		const checkbox = item.querySelector('.select-checkbox')
		checkbox.checked = !checkbox.checked
		if (checkbox.checked) selectedChats.add(chatid)
		else selectedChats.delete(chatid)
	})
})

deleteSelectedButton.addEventListener('click', async () => {
	if (!selectedChats.size) {
		showToastI18n('error', 'chat_history.alerts.noChatSelectedForDeletion')
		return
	}
	if (confirmI18n('chat_history.confirmDeleteMultiChats', { count: selectedChats.size })) try {
		const results = await deleteChats(Array.from(selectedChats))
		results.forEach(result => {
			if (result.success) {
				chatItemDOMCache.delete(result.chatid)
				fullChatList = fullChatList.filter(c => c.chatid !== result.chatid)
				selectedChats.delete(result.chatid)
				document.querySelector(`[data-chatid="${result.chatid}"]`).remove()
			} else showToast('error', result.message)
		})
		filterInput.dispatchEvent(new Event('input'))
	} catch (error) {
		console.error('Error deleting selected chats:', error)
		showToastI18n('error', 'chat_history.alerts.deleteError')
	}
})

exportSelectedButton.addEventListener('click', async () => {
	if (!selectedChats.size) {
		showToastI18n('error', 'chat_history.alerts.noChatSelectedForExport')
		return
	}
	try {
		const results = await exportChats(Array.from(selectedChats))
		for (const result of results) if (result.success) {
			const blob = new Blob([JSON.stringify(result.data, null, '\t')], { type: 'application/json' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `chat-${result.chatid}.json`
			a.click()
			URL.revokeObjectURL(url)
		} else showToast('error', result.message)
	} catch (error) {
		console.error('Error exporting selected chats:', error)
		showToastI18n('error', 'chat_history.alerts.exportError')
	}
})

/**
 * @function initializeApp
 * @memberof chat.public.list
 * @description 初始化应用程序，设置主题、翻译、获取聊天列表、设置搜索功能和无限滚动。
 * @returns {Promise<void>}
 */
async function initializeApp() {
	applyTheme()
	await initTranslations('chat_history')

	fullChatList = await getChatList()
	currentFilteredList = fullChatList

	makeSearchable({
		searchInput: filterInput,
		data: fullChatList,
		/**
		 * @param {Array<object>} filtered - 过滤后的数据。
		 */
		onUpdate: filtered => {
			currentFilteredList = filtered
			renderUI()
		},
	})

	// Setup infinite scroll
	const observer = new IntersectionObserver(entries => {
		if (entries[0].isIntersecting) {
			// Use a timeout to debounce and avoid rapid firing
			if (renderTimeout) clearTimeout(renderTimeout)
			renderTimeout = setTimeout(appendNextChunk, 100)
		}
	}, { rootMargin: '500px' }) // Load next chunk when 500px away from bottom

	const sentinel = document.createElement('div')
	chatListContainer.after(sentinel)
	observer.observe(sentinel)

	await onLanguageChange(() => {
		chatItemDOMCache.clear()
		renderUI()
	})

	renderUI() // Initial render
}

initializeApp().catch(error => {
	showToast('error', error.message)
	window.location.href = '/login'
})
