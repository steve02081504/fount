import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { renderMarkdownAsString } from '../../../scripts/markdown.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { parseRegexFromString, escapeRegExp } from '../../../scripts/regex.mjs'
import { initTranslations, geti18n } from '../../../scripts/i18n.mjs'
import { getChatList, getCharDetails, copyChats, exportChats, deleteChats } from './endpoints.mjs'

usingTemplates('/shells/chat/src/public/templates')

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
 * Applies all filter conditions to a chat.
 * @param {object} chat - The chat object.
 * @param {RegExp[]} commonFilters - Array of common filters.
 * @param {RegExp[]} forceFilters - Array of forced filters.
 * @param {RegExp[]} excludeFilters - Array of excluded filters.
 * @returns {boolean} - True if the chat matches all conditions, false otherwise.
 */
function applyFilters(chat, commonFilters, forceFilters, excludeFilters) {
	const chatString = JSON.stringify(chat)

	// Check for common filters (at least one must match)
	const hasCommonMatch = commonFilters.length === 0 || commonFilters.some(filter => filter.test(chatString))

	// Check for forced filters (all must match)
	const hasForceMatch = forceFilters.every(filter => filter.test(chatString))

	// Check for excluded filters (none must match)
	const hasExcludeMatch = excludeFilters.some(filter => filter.test(chatString))

	return hasCommonMatch && hasForceMatch && !hasExcludeMatch
}

/**
 * Filters the chat list based on user input.
 */
function filterChatList() {
	const filters = filterInput.value.toLowerCase().split(' ').filter(f => f)

	const commonFilters = []
	const forceFilters = []
	const excludeFilters = []

	function parseRegexFilter(filter) {
		if (filter.startsWith('+') || filter.startsWith('-')) filter = filter.slice(1)
		try {
			return parseRegexFromString(filter)
		} catch (_) {
			return new RegExp(escapeRegExp(filter))
		}
	}

	// Categorize filters
	for (const filter of filters) {
		const regex = parseRegexFilter(filter)

		if (filter.startsWith('+'))
			forceFilters.push(regex)
		else if (filter.startsWith('-'))
			excludeFilters.push(regex)
		else
			commonFilters.push(regex)
	}

	// Apply filters and get filtered chat list
	const filteredChatList = chatList.filter(chat =>
		applyFilters(chat, commonFilters, forceFilters, excludeFilters)
	)

	return filteredChatList
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

	chatListContainer.innerHTML = ''
	chatListContainer.append(...await Promise.all(filteredAndSortedList.map(renderChatListItem)))

	// 每次渲染列表后重置选择状态
	selectedChats.clear()
	selectAllCheckbox.checked = false
}

async function renderChatListItem(chat) {
	const lastMsgTime = new Date(chat.lastMessageTime).toLocaleString()
	const data = {
		...chat,
		lastMessageTime: lastMsgTime,
		lastMessageRowContent: chat.lastMessageContent,
		lastMessageContent: await renderMarkdownAsString(chat.lastMessageContent),
		avatars: await Promise.all(chat.chars.map(async charName => {
			const details = await getCharDetails(charName)
			return { name: details.info.name, url: details.info.avatar }
		}))
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
			} else
				alert(data.message)
		} catch (error) {
			console.error('Error copying chat:', error)
			alert(geti18n('chat_history.alerts.copyError'))
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
				} else
					alert(data.message)
		} catch (error) {
			console.error('Error exporting chat:', error)
			alert(geti18n('chat_history.alerts.exportError'))
		}
	})

	// 删除聊天
	chatElement.querySelector('.delete-button').addEventListener('click', async () => {
		if (confirm(geti18n('chat_history.confirmDeleteChat', { chars: chat.chars.join(', ') })))
			try {
				const data = await deleteChats([chat.chatid])
				if (data[0].success) {
					chatList = chatList.filter(c => c.chatid !== chat.chatid)
					renderChatList()
				} else
					alert(data[0].message)
			} catch (error) {
				console.error('Error deleting chat:', error)
				alert(geti18n('chat_history.alerts.deleteError'))
			}
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
	if (selectedChats.size === 0) {
		alert(geti18n('chat_history.alerts.noChatSelectedForDeletion'))
		return
	}
	if (confirm(geti18n('chat_history.confirmDeleteMultiChats', { count: selectedChats.size })))
		try {
			const results = await deleteChats(Array.from(selectedChats))
			results.forEach(result => {
				if (result.success) {
					// Remove only successfully deleted chats from the UI
					chatList = chatList.filter(c => c.chatid !== result.chatid)
					selectedChats.delete(result.chatid) // Also remove from selectedChats
				} else
					alert(result.message)
			})
			renderChatList()
		} catch (error) {
			console.error('Error deleting selected chats:', error)
			alert(geti18n('chat_history.alerts.deleteError'))
		}
})

// 导出选中
exportSelectedButton.addEventListener('click', async () => {
	if (selectedChats.size === 0) {
		alert(geti18n('chat_history.alerts.noChatSelectedForExport'))
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
			} else
				alert(result.message)
	} catch (error) {
		console.error('Error exporting selected chats:', error)
		alert(geti18n('chat_history.alerts.exportError'))
	}
})

// 在焦点返回时重新渲染聊天列表
window.addEventListener('focus', getChatList().then(renderChatList))

async function initializeApp() {
	applyTheme()
	await initTranslations('chat_history') // Initialize translations for 'chat_history'
	chatList = await getChatList()
	await renderChatList()
}

initializeApp().catch(error => {
	alert(error.message)
	window.location.href = '/login'
})
