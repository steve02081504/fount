import { renderTemplate } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { parseRegexFromString, escapeRegExp } from '../../../scripts/regex.mjs'

const chatListContainer = document.getElementById('chat-list-container')
const sortSelect = document.getElementById('sort-select')
const filterInput = document.getElementById('filter-input')
const selectAllCheckbox = document.getElementById('select-all-checkbox')
const reverseSelectButton = document.getElementById('reverse-select-button')
const deleteSelectedButton = document.getElementById('delete-selected-button')
const exportSelectedButton = document.getElementById('export-selected-button')

let chatList = []
const selectedChats = new Set()

async function fetchChatList() {
	const response = await fetch('/api/shells/chat/list', {
		method: 'POST',
	})
	if (response.ok)
		chatList = await response.json()
	else {
		console.error('Failed to fetch chat list')
		chatList = []
	}
}

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
		const parsed = parseRegexFromString(filter)
		return parsed ? parsed : new RegExp(escapeRegExp(filter))
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

const char_details_cache = {}
async function getCharDetails(charname) {
	char_details_cache[charname] ??= fetch('/api/getdetails/chars?name=' + charname).then(res => res.json())
	return char_details_cache[charname] = await char_details_cache[charname]
}

async function renderChatListItem(chat) {
	const lastMsgTime = new Date(chat.lastMessageTime).toLocaleString()
	const data = {
		...chat,
		lastMessageTime: lastMsgTime,
		avatars: await Promise.all(chat.chars.map(async charName => {
			const details = await getCharDetails(charName)
			return { name: details.info.name, url: details.info.avatar }
		}))
	}
	const chatElement = await renderTemplate('chat_list_view', data)
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
	chatElement.querySelector('.continue-button').addEventListener('click', () => {
		window.location = `/shells/chat#${chat.chatid}`
	})

	// 复制聊天
	chatElement.querySelector('.copy-button').addEventListener('click', async () => {
		const response = await fetch('/api/shells/chat/copy', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ chatids: [chat.chatid] }), // Send as array
		})
		if (response.ok) {
			const datas = await response.json()
			const data = datas[0]
			if (data.success) // refresh chat list
				fetchChatList().then(renderChatList)
			else
				alert(data.message)
		}
	})

	// 导出聊天
	chatElement.querySelector('.export-button').addEventListener('click', async () => {
		const response = await fetch('/api/shells/chat/export', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ chatids: [chat.chatid] }), // Send as array
		})
		if (response.ok) {
			const datas = await response.json()
			for (const data of datas)
				if (data.success) {
					const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
					const url = URL.createObjectURL(blob)
					const a = document.createElement('a')
					a.href = url
					a.download = `chat-${chat.chatid}.json`
					a.click()
					URL.revokeObjectURL(url)
				}
				else alert(data.message)
		}
	})

	// 删除聊天
	chatElement.querySelector('.delete-button').addEventListener('click', async () => {
		if (confirm(`确定要删除与 ${chat.chars.join(', ')} 的聊天记录吗？`)) {
			const response = await fetch('/api/shells/chat/delete', {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ chatids: [chat.chatid] }), // Send as array
			})
			if (response.ok) {
				const data = await response.json()
				if (data[0].success) {
					chatList = chatList.filter(c => c.chatid !== chat.chatid)
					renderChatList()
				}
				else alert(data[0].message)
			}
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
		alert('请选择要删除的聊天记录')
		return
	}
	if (confirm(`确定要删除选中的 ${selectedChats.size} 条聊天记录吗？`)) {
		const response = await fetch('/api/shells/chat/delete', {
			method: 'DELETE',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ chatids: Array.from(selectedChats) }),
		})
		if (response.ok) {
			const results = await response.json()
			results.forEach(result => {
				if (result.success) {
					// Remove only successfully deleted chats from the UI
					chatList = chatList.filter(c => c.chatid !== result.chatid)
					selectedChats.delete(result.chatid) // Also remove from selectedChats
				}
				else alert(result.message)

			})
			renderChatList()
		}
	}
})

// 导出选中
exportSelectedButton.addEventListener('click', async () => {
	if (selectedChats.size === 0) {
		alert('请选择要导出的聊天记录')
		return
	}
	const response = await fetch('/api/shells/chat/export', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids: Array.from(selectedChats) }),
	})
	if (response.ok) {
		const results = await response.json()
		for (const result of results)
			if (result.success) {
				const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = `chat-${result.chatid}.json`
				a.click()
				URL.revokeObjectURL(url)
			}
			else alert(result.message)
	}
})

async function initializeApp() {
	applyTheme()
	await fetchChatList()
	renderChatList()
}

initializeApp()
