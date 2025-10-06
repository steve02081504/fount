import { initTranslations, confirmI18n, console, onLanguageChange } from '../../../scripts/i18n.mjs'
import { renderMarkdown, renderMarkdownAsString } from '../../../scripts/markdown.mjs'
import { compileFilter } from '../../../scripts/search.mjs'
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

let chatList = []
const selectedChats = new Set()

/**
 * Filters the chat list based on user input.
 */
function filterChatList() {
	return chatList.filter(compileFilter(filterInput.value))
}

async function renderChatList() {
	const filteredAndSortedList = filterChatList()
		.sort((a, b) => {
			const sortValue = sortSelect.value
			const timeA = new Date(a.lastMessageTime).getTime()
			const timeB = new Date(b.lastMessageTime).getTime()
			if (sortValue === 'time_asc')
				return timeA - timeB
			else
				return timeB - timeA
		})

	const chats = await Promise.all(filteredAndSortedList.map(renderChatListItem))
	chatListContainer.innerHTML = ''
	chatListContainer.append(...chats)

	// 每次渲染列表后重置选择状态
	selectedChats.clear()
	selectAllCheckbox.checked = false
}

/**
 * 渲染 Markdown 字符串，并截取预览内容。
 * 预览内容定义为前 N+1 个非Trivial的节点之前的全部节点。
 * Trivial 节点包括 <br>, <script>, <link>, <style>, <meta>, 注释, 以及纯空白文本节点。
 * @param {string} markdown - The input markdown string.
 * @param {number} significantNodeLimit - The number of significant nodes to keep.
 * @returns {Promise<string>} A promise that resolves to the preview HTML string.
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

	// 添加选择框
	const selectCheckbox = chatElement.querySelector('.select-checkbox')
	selectCheckbox.checked = selectedChats.has(chat.chatid)
	selectCheckbox.addEventListener('change', () => {
		if (selectCheckbox.checked)
			selectedChats.add(chat.chatid)
		else {
			selectedChats.delete(chat.chatid)
			selectAllCheckbox.checked = false
		}
	})

	// 继续聊天
	chatElement.querySelector('.continue-button').href = `/shells/chat#${chat.chatid}`

	// 复制聊天
	chatElement.querySelector('.copy-button').addEventListener('click', async () => {
		try {
			const datas = await copyChats([chat.chatid])
			const data = datas[0]
			if (data.success) {
				chatList = await getChatList() // refresh chat list
				renderChatList()
			}
			else showToast('error', data.message)
		}
		catch (error) {
			console.error('Error copying chat:', error)
			showToastI18n('error', 'chat_history.alerts.copyError')
		}
	})

	// 导出聊天
	chatElement.querySelector('.export-button').addEventListener('click', async () => {
		try {
			const datas = await exportChats([chat.chatid])
			for (const data of datas)
				if (data.success) {
					const blob = new Blob([JSON.stringify(data.data, null, '\t')], { type: 'application/json' })
					const url = URL.createObjectURL(blob)
					const a = document.createElement('a')
					a.href = url
					a.download = `chat-${chat.chatid}.json`
					a.click()
					URL.revokeObjectURL(url)
				}
				else showToast('error', data.message)
		}
		catch (error) {
			console.error('Error exporting chat:', error)
			showToastI18n('error', 'chat_history.alerts.exportError')
		}
	})

	// 删除聊天
	chatElement.querySelector('.delete-button').addEventListener('click', async () => {
		if (confirmI18n('chat_history.confirmDeleteChat', { chars: chat.chars.join(', ') })) try {
			const data = await deleteChats([chat.chatid])
			if (data[0].success) {
				chatItemDOMCache.delete(chat.chatid)
				chatList = chatList.filter(c => c.chatid !== chat.chatid)
				renderChatList()
			}
			else showToast('error', data[0].message)
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

sortSelect.addEventListener('change', renderChatList)
filterInput.addEventListener('input', renderChatList)

// 全选
selectAllCheckbox.addEventListener('change', () => {
	const chatItems = document.querySelectorAll('.chat-list-item')
	chatItems.forEach(item => {
		const chatid = item.getAttribute('data-chatid')
		const checkbox = item.querySelector('.select-checkbox')
		checkbox.checked = selectAllCheckbox.checked
		if (selectAllCheckbox.checked)
			selectedChats.add(chatid)
		else
			selectedChats.delete(chatid)
	})
})

// 反选
reverseSelectButton.addEventListener('click', () => {
	const chatItems = document.querySelectorAll('.chat-list-item')
	chatItems.forEach(item => {
		const chatid = item.getAttribute('data-chatid')
		const checkbox = item.querySelector('.select-checkbox')
		checkbox.checked = !checkbox.checked
		if (checkbox.checked)
			selectedChats.add(chatid)
		else
			selectedChats.delete(chatid)
	})
})

// 删除选中
deleteSelectedButton.addEventListener('click', async () => {
	if (!selectedChats.size) {
		showToastI18n('error', 'chat_history.alerts.noChatSelectedForDeletion')
		return
	}
	if (confirmI18n('chat_history.confirmDeleteMultiChats', { count: selectedChats.size })) try {
		const results = await deleteChats(Array.from(selectedChats))
		results.forEach(result => {
			if (result.success) {
				// Remove only successfully deleted chats from the UI
				chatItemDOMCache.delete(result.chatid)
				chatList = chatList.filter(c => c.chatid !== result.chatid)
				selectedChats.delete(result.chatid) // Also remove from selectedChats
			}
			else showToast('error', result.message)
		})
		renderChatList()
	} catch (error) {
		console.error('Error deleting selected chats:', error)
		showToastI18n('error', 'chat_history.alerts.deleteError')
	}
})

// 导出选中
exportSelectedButton.addEventListener('click', async () => {
	if (!selectedChats.size) {
		showToastI18n('error', 'chat_history.alerts.noChatSelectedForExport')
		return
	}
	try {
		const results = await exportChats(Array.from(selectedChats))
		for (const result of results)
			if (result.success) {
				const blob = new Blob([JSON.stringify(result.data, null, '\t')], { type: 'application/json' })
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = `chat-${result.chatid}.json`
				a.click()
				URL.revokeObjectURL(url)
			}
			else showToast('error', result.message)
	}
	catch (error) {
		console.error('Error exporting selected chats:', error)
		showToastI18n('error', 'chat_history.alerts.exportError')
	}
})

async function initializeApp() {
	applyTheme()
	await initTranslations('chat_history') // Initialize translations for 'chat_history'
	chatList = await getChatList()
	await onLanguageChange(renderChatList)
}

initializeApp().catch(error => {
	showToast('error', error.message)
	window.location.href = '/login'
})
