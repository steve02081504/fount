/**
 * 【文件】public/list/index.mjs
 * 【职责】聊天历史列表页 UI：虚拟列表展示、排序筛选、多选批量操作与导入。
 * 【原理】getGroupSessionList 拉全量后本地 filter/sort；createVirtualList 渲染行；模板 chat-list-item；操作委托 endpoints.mjs。
 * 【数据结构】fullGroupSessionList、currentFilteredList、selectedChats(Set)、virtualList 实例。
 * 【关联】list/endpoints.mjs；virtualList.mjs、template.mjs；Hub 跳转链接。
 */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { makeSearchable } from '../../../scripts/components/search.mjs'
import { renderMarkdown, renderMarkdownAsString } from '../../../scripts/features/markdown/index.mjs'
import {
	mountTemplate,
	renderTemplate,
	usingTemplates,
} from '../../../scripts/features/template.mjs'
import { showToast, showToastI18n } from '../../../scripts/features/toast.mjs'
import { initTranslations, confirmI18n, console, onLanguageChange } from '../../../scripts/i18n/index.mjs'
import { createVirtualList } from '../../../scripts/lib/virtualList.mjs'
import { applyTheme } from '../../../scripts/theme/index.mjs'
import { processTimeStampForId } from '../src/lib/timestampId.mjs'

import { getGroupSessionList, getCharDetails, copyGroupSessions, exportGroupSessions, deleteGroupSessions, importGroupSession } from './endpoints.mjs'

usingTemplates('/parts/shells:chat/src/templates')

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

let fullGroupSessionList = []
let currentFilteredList = []
const selectedChats = new Set()

let virtualList = null

/**
 * 从 JSON 文件导入会话并刷新列表。
 * @param {File} file 用户选择的 JSON 文件
 * @returns {Promise<boolean>} 导入成功为 true
 */
async function importGroupSessionFromFile(file) {
	const result = await importGroupSession(JSON.parse(await file.text()))
	if (!result.error) {
		showToastI18n('success', 'chat_history.alerts.importSuccess')
		fullGroupSessionList.splice(0, fullGroupSessionList.length, ...await getGroupSessionList())
		filterInput.dispatchEvent(new Event('input'))
		return true
	}
	showToast('error', result.error || result.message)
	return false
}

/**
 * 仅更新选择相关的 UI（全选 checkbox 与各列表项的 checkbox），不重新渲染列表。
 */
function updateSelectionUI() {
	selectAllCheckbox.checked = currentFilteredList.every(c => selectedChats.has(c.groupId))
	for (const checkbox of chatListContainer.querySelectorAll('.select-checkbox')) {
		const chatElement = checkbox.closest('.chat-list-item')
		const groupId = chatElement?.dataset?.groupId
		checkbox.checked = selectedChats.has(groupId)
	}
}

/**
 * 根据当前的过滤和排序设置对聊天列表进行排序和渲染。
 * 它会重置 UI 并使用虚拟列表进行渲染。
 * @returns {Promise<void>}
 */
async function renderUI() {
	const ascending = sortSelect.value === 'time_asc'
	const fullSortedList = [...currentFilteredList].sort((a, b) => {
		const timeA = new Date(a.lastMessageTime).getTime()
		const timeB = new Date(b.lastMessageTime).getTime()
		return ascending ? timeA - timeB : timeB - timeA
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
		avatars: await Promise.all((chat.chars || []).map(async charName => {
			const details = await getCharDetails(charName)
			return { name: details.info.name, url: details.info.avatar }
		})),
		renderMarkdownPreview
	}

	const realElement = await mountTemplate(chatElement, 'list/chat_list_view', data)
	chatElement.className = realElement.className || chatElement.className
	chatElement.removeAttribute('data-template-type')
	chatElement.dataset.groupId = chat.groupId

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
			const downloadUrl = `/api/parts/shells:chat/groups/${encodeURIComponent(chat.groupId)}/export`
			const fullDownloadUrl = `${window.location.origin}${downloadUrl}`
			const fileName = `chat-${chat.groupId}.json`
			event.dataTransfer.setData('DownloadURL', `application/json:${fileName}:${fullDownloadUrl}`)

			const chatUrl = new URL(`/parts/shells:chat/hub/#group:${chat.groupId}:default`, window.location.origin)
			event.dataTransfer.setData('text/uri-list', chatUrl.href)
		}
		catch (error) {
			console.error('Error setting drag data for chat list item:', error)
			showToastI18n('error', 'chat_history.alerts.dragExportError')
		}
	})

	// Checkbox logic
	const selectCheckbox = chatElement.querySelector('.select-checkbox')
	Object.assign(selectCheckbox.dataset, { chars: (chat.chars || []).join(', ') })
	selectCheckbox.checked = selectedChats.has(chat.groupId)
	selectCheckbox.addEventListener('change', () => {
		if (selectCheckbox.checked) selectedChats.add(chat.groupId)
		else selectedChats.delete(chat.groupId)
		selectAllCheckbox.checked = selectCheckbox.checked && currentFilteredList.every(c => selectedChats.has(c.groupId))
	})

	// Button listeners
	chatElement.querySelector('.copy-button').addEventListener('click', async () => {
		try {
			const datas = await copyGroupSessions([chat.groupId])
			if (!datas[0]?.error) {
				fullGroupSessionList = await getGroupSessionList()
				renderUI()
			}
			else showToast('error', datas[0]?.error || datas[0]?.message)
		} catch (error) {
			console.error('Error copying chat:', error)
			showToastI18n('error', 'chat_history.alerts.copyError')
		}
	})

	chatElement.querySelector('.export-button').addEventListener('click', async () => {
		try {
			const datas = await exportGroupSessions([chat.groupId])
			for (const data of datas) if (!data.error) {
				const blob = new Blob([JSON.stringify(data.data, null, '\t')], { type: 'application/json' })
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = `chat-${data.groupId}.json`
				a.click()
				URL.revokeObjectURL(url)
			}
			else showToast('error', data.error)
		} catch (error) {
			console.error('Error exporting chat:', error)
			showToastI18n('error', 'chat_history.alerts.exportError')
		}
	})

	chatElement.querySelector('.delete-button').addEventListener('click', async () => {
		if (confirmI18n('chat_history.confirmDeleteChat', { chars: chat.chars.join(', ') })) try {
			const data = await deleteGroupSessions([chat.groupId])
			if (!data[0]?.error) {
				const index = fullGroupSessionList.findIndex(c => c.groupId === chat.groupId)
				if (index > -1) fullGroupSessionList.splice(index, 1)
				filterInput.dispatchEvent(new Event('input'))
			}
			else showToast('error', data[0].error || data[0].message)
		} catch (error) {
			console.error('Error deleting chat:', error)
			showToastI18n('error', 'chat_history.alerts.deleteError')
		}
	})
	chatItemDOMCache.set(chat.groupId, {
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
	if (chatItemDOMCache.has(chat.groupId)) {
		const cachedData = chatItemDOMCache.get(chat.groupId)
		if (cachedData.lastMessageTime === chat.lastMessageTime) {
			const chatElement = cachedData.element
			const selectCheckbox = chatElement.querySelector('.select-checkbox')
			// 检查 selectCheckbox 是否存在，因为骨架屏可能还没 hydrate
			if (selectCheckbox) selectCheckbox.checked = selectedChats.has(chat.groupId)
			return chatElement
		}
	}

	const chatElement = await renderTemplate('list/chat_list_skeleton', { groupId: chat.groupId })

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
			selectedChats.add(chat.groupId)
		else
			selectedChats.delete(chat.groupId)
	updateSelectionUI()
})

reverseSelectButton.addEventListener('click', () => {
	for (const chat of currentFilteredList)
		if (selectedChats.has(chat.groupId))
			selectedChats.delete(chat.groupId)
		else
			selectedChats.add(chat.groupId)
	updateSelectionUI()
})
deleteSelectedButton.addEventListener('click', async () => {
	if (!selectedChats.size) {
		showToastI18n('error', 'chat_history.alerts.noChatSelectedForDeletion')
		return
	}
	if (confirmI18n('chat_history.confirmDeleteMultiChats', { count: selectedChats.size })) try {
		const chatsToDelete = Array.from(selectedChats)
		const results = await deleteGroupSessions(chatsToDelete)

		const successfullyDeletedIds = new Set()
		for (const result of results)
			if (!result.error) {
				successfullyDeletedIds.add(result.groupId)
				selectedChats.delete(result.groupId)
			}
			else showToast('error', result.error || result.message)


		if (successfullyDeletedIds.size) {
			fullGroupSessionList = fullGroupSessionList.filter(chat => !successfullyDeletedIds.has(chat.groupId))
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
		const results = await exportGroupSessions(Array.from(selectedChats))
		for (const result of results) if (!result.error) {
			const blob = new Blob([JSON.stringify(result.data, null, '\t')], { type: 'application/json' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `chat-${result.groupId}.json`
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
		await importGroupSessionFromFile(file)
	}
	catch (error) {
		console.error('Error importing chat:', error)
		showToastI18n('error', 'chat_history.alerts.importError')
	}
	finally {
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

	fullGroupSessionList = (await getGroupSessionList()).map(c => ({
		...c,
		chars: Array.isArray(c.chars) ? c.chars : [],
	}))
	currentFilteredList = fullGroupSessionList

	makeSearchable({
		searchInput: filterInput,
		data: fullGroupSessionList,
		/**
		 * 更新过滤后的数据。
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
			await importGroupSessionFromFile(file)
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
	setTimeout(() => window.location.href = '/shells/home', 5000)
})
