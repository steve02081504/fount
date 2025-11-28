/**
 * 聊天历史列表页面的客户端逻辑。
 */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { initTranslations, confirmI18n, console, i18nElement, onLanguageChange } from '../../../scripts/i18n.mjs'
import { renderMarkdown, renderMarkdownAsString } from '../../../scripts/markdown.mjs'
import { makeSearchable } from '../../../scripts/search.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast, showToastI18n } from '../../../scripts/toast.mjs'
import { createVirtualList } from '../../../scripts/virtualList.mjs'
import { processTimeStampForId } from '../src/utils.mjs'

import { getChatList, getCharDetails, copyChats, exportChats, deleteChats, importChat } from './endpoints.mjs'

usingTemplates('/shells/chat/src/templates')

const chatItemDOMCache = new Map()
const chatListContainer = document.getElementById('chat-list-container')
const sortSelect = document.getElementById('sort-select')
const filterInput = document.getElementById('filter-input')
const selectAllCheckbox = document.getElementById('select-all-checkbox')
const reverseSelectButton = document.getElementById('reverse-select-button')
const deleteSelectedButton = document.getElementById('delete-selected-button')
const exportSelectedButton = document.getElementById('export-selected-button')
const importButton = document.getElementById('import-button')
const importFileInput = document.getElementById('import-file-input')

let fullChatList = []
let currentFilteredList = []
const selectedChats = new Set()

let virtualList = null

/**
 * 根据当前的过滤和排序设置对聊天列表进行排序和渲染。
 * 它会重置 UI 并使用虚拟列表进行渲染。
 * @returns {Promise<void>}
 */
async function renderUI() {
	const fullSortedList = [...currentFilteredList].sort((a, b) => {
		const sortValue = sortSelect.value
		const timeA = new Date(a.lastMessageTime).getTime()
		const timeB = new Date(b.lastMessageTime).getTime()
		return sortValue === 'time_asc' ? timeA - timeB : timeB - timeA
	})

	// Clear selection state
	selectedChats.clear()
	selectAllCheckbox.checked = false

	if (virtualList)
		virtualList.destroy()


	virtualList = createVirtualList({
		container: chatListContainer,
		/**
		 * 从已排序/筛选的列表中提取数据块。
		 * @param {number} offset - 数据块的起始索引。
		 * @param {number} limit - 数据块的大小。
		 * @returns {Promise<{items: Array<object>, total: number}>} 包含项目和总数的对象。
		 */
		fetchData: async (offset, limit) => {
			const items = fullSortedList.slice(offset, offset + limit)
			return { items, total: fullSortedList.length }
		},
		renderItem: renderChatListItem,
		setInitialScroll: false
	})
}

/**
 * 通过将 Markdown 字符串截断为一定数量的重要节点来渲染预览。
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
 * 观察器用于懒加载聊天列表项。
 */
const lazyLoadObserver = new IntersectionObserver((entries, observer) => {
	entries.forEach(entry => {
		if (entry.isIntersecting) {
			const element = entry.target
			const chat = element.chatData
			if (chat) {
				hydrateChatListItem(element, chat)
				observer.unobserve(element)
				delete element.chatData
			}
		}
	})
}, { rootMargin: '200px' })

/**
 * 激活聊天列表项，渲染真实内容并绑定事件。
 * @param {HTMLElement} chatElement - 骨架屏元素。
 * @param {object} chat - 聊天对象。
 */
async function hydrateChatListItem(chatElement, chat) {
	const lastMsgTime = new Date(chat.lastMessageTime).toLocaleString()
	const data = {
		...chat,
		safeTimeStamp: processTimeStampForId(chat.lastMessageTime),
		lastMessageTime: lastMsgTime,
		lastMessageRowContent: chat.lastMessageContent,
		lastMessageContent: await renderMarkdownAsString(chat.lastMessageContent),
		avatars: await Promise.all(chat.chars.map(async charName => {
			const details = await getCharDetails(charName)
			return { name: details.info.name, url: details.info.avatar }
		})),
		renderMarkdownPreview
	}

	const realElement = await renderTemplate('list/chat_list_view', data)

	// 替换内容
	chatElement.innerHTML = realElement.innerHTML
	chatElement.className = realElement.className
	chatElement.removeAttribute('data-template-type')
	chatElement.setAttribute('data-chatid', chat.chatid)

	// Drag-and-drop functionality
	chatElement.addEventListener('mousedown', e => {
		// If the mousedown is on an interactive part, don't make the chat element draggable.
		// This allows text selection, button clicks, collapse/expand, etc.
		if (e.target.closest('.message-content'))
			chatElement.draggable = false
		else
			// Otherwise, allow dragging the whole chat element.
			chatElement.draggable = true
	})

	/**
	 * 清理可拖拽状态以防止意外行为。
	 * @returns {void}
	 */
	const cleanupDraggable = () => { chatElement.draggable = false }
	chatElement.addEventListener('mouseup', cleanupDraggable)
	chatElement.addEventListener('mouseleave', cleanupDraggable)
	chatElement.addEventListener('dragend', cleanupDraggable)

	chatElement.addEventListener('dragstart', event => {
		try {
			const downloadUrl = `/virtual_files/shells/chat/${chat.chatid}`
			const fullDownloadUrl = `${window.location.origin}${downloadUrl}`
			const fileName = `chat-${chat.chatid}.json`
			event.dataTransfer.setData('DownloadURL', `application/json:${fileName}:${fullDownloadUrl}`)

			const chatUrl = new URL(`/shells/chat#${chat.chatid}`, window.location.origin)
			event.dataTransfer.setData('text/uri-list', chatUrl.href)
		}
		catch (error) {
			console.error('Error setting drag data for chat list item:', error)
			showToastI18n('error', 'chat_history.alerts.dragExportError')
		}
	})

	// Checkbox logic
	const selectCheckbox = chatElement.querySelector('.select-checkbox')
	// for i18n
	Object.assign(selectCheckbox.dataset, { chars: chat.chars.join(', ') })
	i18nElement(selectCheckbox)
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
				renderUI() // 触发重绘
			} else showToast('error', datas[0]?.message)
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
				const index = fullChatList.findIndex(c => c.chatid === chat.chatid)
				if (index > -1) fullChatList.splice(index, 1)
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
}

/**
 * 为单个聊天会话渲染 HTML 元素（初始为骨架屏）。
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
			// 检查 selectCheckbox 是否存在，因为骨架屏可能还没 hydrate
			if (selectCheckbox) selectCheckbox.checked = selectedChats.has(chat.chatid)
			return chatElement
		}
	}

	const chatElement = await renderTemplate('list/chat_list_skeleton', { chatid: chat.chatid })

	// 绑定数据以供 hydrate 使用
	chatElement.chatData = chat

	// 开始观察
	lazyLoadObserver.observe(chatElement)

	return chatElement
}

sortSelect.addEventListener('change', renderUI)

// Bulk actions
selectAllCheckbox.addEventListener('change', () => {
	const isChecked = selectAllCheckbox.checked
	for (const chat of currentFilteredList)
		if (isChecked)
			selectedChats.add(chat.chatid)
		else
			selectedChats.delete(chat.chatid)
	renderUI() // 触发重绘
})

reverseSelectButton.addEventListener('click', () => {
	for (const chat of currentFilteredList)
		if (selectedChats.has(chat.chatid))
			selectedChats.delete(chat.chatid)
		else
			selectedChats.add(chat.chatid)
	renderUI() // 触发重绘
})
deleteSelectedButton.addEventListener('click', async () => {
	if (!selectedChats.size) {
		showToastI18n('error', 'chat_history.alerts.noChatSelectedForDeletion')
		return
	}
	if (confirmI18n('chat_history.confirmDeleteMultiChats', { count: selectedChats.size })) try {
		const chatsToDelete = Array.from(selectedChats)
		const results = await deleteChats(chatsToDelete)

		const successfullyDeletedIds = new Set()
		results.forEach(result => {
			if (result.success) {
				successfullyDeletedIds.add(result.chatid)
				selectedChats.delete(result.chatid)
			} else showToast('error', result.message)
		})

		if (successfullyDeletedIds.size) {
			let i = fullChatList.length
			while (i--)
				if (successfullyDeletedIds.has(fullChatList[i].chatid))
					fullChatList.splice(i, 1)
			filterInput.dispatchEvent(new Event('input'))
		}
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

importButton.addEventListener('click', () => {
	importFileInput.click()
})

importFileInput.addEventListener('change', async event => {
	const file = event.target.files[0]
	if (!file) return

	try {
		const fileContent = await file.text()
		const chatData = JSON.parse(fileContent)
		const result = await importChat(chatData)
		if (result.success) {
			showToastI18n('success', 'chat_history.alerts.importSuccess')
			const newList = await getChatList()
			fullChatList.splice(0, fullChatList.length, ...newList)
			filterInput.dispatchEvent(new Event('input'))
		}
		else
			showToast('error', result.message)
	}
	catch (error) {
		console.error('Error importing chat:', error)
		showToastI18n('error', 'chat_history.alerts.importError')
	}
	finally {
		// Reset the input so the same file can be selected again
		importFileInput.value = ''
	}
})

/**
 * 初始化应用程序，设置主题、翻译、获取聊天列表、设置搜索功能和虚拟滚动。
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

	await renderUI()

	await onLanguageChange(() => {
		chatItemDOMCache.clear()
		renderUI()
	})

	// Add drag-and-drop import listeners
	document.body.addEventListener('dragover', event => {
		event.preventDefault()
		document.body.classList.add('drag-over')
	})

	document.body.addEventListener('dragleave', () => {
		document.body.classList.remove('drag-over')
	})

	document.body.addEventListener('drop', async event => {
		event.preventDefault()
		document.body.classList.remove('drag-over')

		if (!event.dataTransfer.files.length) return
		const file = event.dataTransfer.files[0]
		if (file.type !== 'application/json') {
			showToastI18n('error', 'chat_history.alerts.invalidImportFile')
			return
		}

		try {
			const fileContent = await file.text()
			const chatData = JSON.parse(fileContent)
			const result = await importChat(chatData)
			if (result.success) {
				showToastI18n('success', 'chat_history.alerts.importSuccess')
				const newList = await getChatList()
				fullChatList.splice(0, fullChatList.length, ...newList)
				filterInput.dispatchEvent(new Event('input'))
			}
			else
				showToast('error', result.message)
		}
		catch (error) {
			console.error('Error importing chat:', error)
			showToastI18n('error', 'chat_history.alerts.importError')
		}
	})
}

initializeApp().catch(error => {
	Sentry.captureException(error)
	showToast('error', error.message)
	console.error('Initialization failed:', error)
	setTimeout(() => globalThis.location.href = '/shells/home', 5000)
})
