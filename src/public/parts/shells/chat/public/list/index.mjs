/**
 * 聊天历史列表页面的客户端逻辑。
 */
import { initTranslations, confirmI18n, geti18n, i18nElement, onLanguageChange, setLocalizeLogic } from '../../../scripts/i18n.mjs'
import { renderMarkdown, renderMarkdownAsString } from '../../../scripts/markdown.mjs'
import { makeSearchable } from '../../../scripts/search.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast, showToastI18n } from '../../../scripts/toast.mjs'
import { createVirtualList } from '../../../scripts/virtualList.mjs'
import { handleUIError, normalizeError, processTimeStampForId } from '../src/utils.mjs'

import { getChatList, getCharDetails, copyChats, exportChats, deleteChats, importChat, getGroupList, createDmRoom, getGroupFolders, saveGroupFolders } from './endpoints.mjs'

usingTemplates('/parts/shells:chat/src/templates')

const chatItemDOMCache = new Map()
const chatListContainer = document.getElementById('chat-list-container')
const groupLinksEl = document.getElementById('group-links')
const newDmButton = document.getElementById('new-dm-button')
const groupFoldersListEl = document.getElementById('group-folders-list')
const addGroupFolderBtn = document.getElementById('add-group-folder-btn')
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
 * 仅更新选择相关的 UI（全选 checkbox 与各列表项的 checkbox），不重新渲染列表。
 */
function updateSelectionUI() {
	selectAllCheckbox.checked = currentFilteredList.every(c => selectedChats.has(c.chatid))
	for (const checkbox of chatListContainer.querySelectorAll('.select-checkbox')) {
		const chatElement = checkbox.closest('.chat-list-item')
		const chatid = chatElement?.dataset?.chatid
		checkbox.checked = selectedChats.has(chatid)
	}
}

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
	chatElement.dataset.chatid = chat.chatid

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
			const downloadUrl = `/virtual_files/parts/shells:chat/${chat.chatid}`
			const fullDownloadUrl = `${window.location.origin}${downloadUrl}`
			const fileName = `chat-${chat.chatid}.json`
			event.dataTransfer.setData('DownloadURL', `application/json:${fileName}:${fullDownloadUrl}`)

			const chatUrl = new URL(`/shells/chat#group:${chat.chatid}:default`, window.location.origin)
			event.dataTransfer.setData('text/uri-list', chatUrl.href)
		}
		catch (error) {
			handleUIError(normalizeError(error), 'chat_history.alerts.dragExportError', 'chat list dragstart')
		}
	})

	// Checkbox logic
	const selectCheckbox = chatElement.querySelector('.select-checkbox')
	// for i18n
	Object.assign(selectCheckbox.dataset, { chars: chat.chars.join(', ') })
	i18nElement(selectCheckbox)
	selectCheckbox.checked = selectedChats.has(chat.chatid)
	selectCheckbox.addEventListener('change', () => {
		if (selectCheckbox.checked) selectedChats.add(chat.chatid)
		else selectedChats.delete(chat.chatid)
		selectAllCheckbox.checked = selectCheckbox.checked && currentFilteredList.every(c => selectedChats.has(c.chatid))
	})

	// Button listeners
	chatElement.querySelector('.copy-button').addEventListener('click', async () => {
		try {
			const datas = await copyChats([chat.chatid])
			if (datas[0]?.success) {
				fullChatList = await getChatList()
				renderUI() // 触发重绘
			} else showToast('error', datas[0]?.message)
		} catch (error) {
			handleUIError(normalizeError(error), 'chat_history.alerts.copyError', 'copy chat')
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
			handleUIError(normalizeError(error), 'chat_history.alerts.exportError', 'export chat')
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
			handleUIError(normalizeError(error), 'chat_history.alerts.deleteError', 'delete chat')
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
	updateSelectionUI()
})

reverseSelectButton.addEventListener('click', () => {
	for (const chat of currentFilteredList)
		if (selectedChats.has(chat.chatid))
			selectedChats.delete(chat.chatid)
		else
			selectedChats.add(chat.chatid)
	updateSelectionUI()
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
		handleUIError(normalizeError(error), 'chat_history.alerts.deleteError', 'delete selected chats')
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
		handleUIError(normalizeError(error), 'chat_history.alerts.exportError', 'export selected chats')
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
		handleUIError(normalizeError(error), 'chat_history.alerts.importError', 'import chat (file input)')
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
const GROUP_DRAG_MIME = 'application/x-fount-group-id'
const FOLDER_REORDER_MIME = 'application/x-fount-folder-index'

/** @type {Record<string, string>} */
const FOLDER_COLOR_BORDER = {
	neutral: 'border-l-neutral',
	primary: 'border-l-primary',
	secondary: 'border-l-secondary',
	accent: 'border-l-accent',
}

/**
 * 绑定本地化逻辑，减少重复 setLocalizeLogic 样板代码。
 * @template {HTMLElement} T
 * @param {T} element - 需要绑定本地化逻辑的 DOM 元素。
 * @param {(text: string) => void} apply - 获取翻译文本后执行的赋值逻辑。
 * @param {string} i18nKey - `geti18n` 使用的翻译键名。
 * @returns {T} 返回原始元素，便于链式或就地使用。
 */
function bindLocalize(element, apply, i18nKey) {
	setLocalizeLogic(element, () => {
		apply(geti18n(i18nKey))
	})
	return element
}

/**
 * 渲染群组文件夹
 * @returns {Promise<void>}
 */
async function renderGroupFolders() {
	if (!groupFoldersListEl) return
	const [data, groupListData] = await Promise.all([getGroupFolders(), getGroupList()])
	const folders = Array.isArray(data.folders) ? data.folders : []
	/** @type {Map<string, string>} groupId → 显示名称 */
	const groupNameMap = new Map((groupListData.groups || []).map(g => [g.id, g.name || g.id]))
	groupFoldersListEl.innerHTML = ''
	if (!folders.length) {
		const li = document.createElement('li')
		li.className = 'text-xs opacity-50'
		li.textContent = '—'
		groupFoldersListEl.appendChild(li)
		return
	}
	folders.forEach((folder, idx) => {
		const li = document.createElement('li')
		const colorKey = folder.color && FOLDER_COLOR_BORDER[folder.color] ? folder.color : 'neutral'
		li.className = `border border-base-300 rounded-lg p-2 bg-base-100 border-l-4 pl-2 ${FOLDER_COLOR_BORDER[colorKey]}`
		li.draggable = true
		li.dataset.folderIndex = String(idx)
		li.addEventListener('dragstart', e => {
			e.dataTransfer.setData(FOLDER_REORDER_MIME, String(idx))
			e.dataTransfer.effectAllowed = 'move'
		})
		li.addEventListener('dragover', e => {
			e.preventDefault()
			li.classList.add('outline', 'outline-2', 'outline-primary/40')
		})
		li.addEventListener('dragleave', () => {
			li.classList.remove('outline', 'outline-2', 'outline-primary/40')
		})
		li.addEventListener('drop', async e => {
			e.preventDefault()
			li.classList.remove('outline', 'outline-2', 'outline-primary/40')
			const fresh = await getGroupFolders()
			const list = [...fresh.folders || []]
			const gid = e.dataTransfer.getData(GROUP_DRAG_MIME)
			if (gid) {
				const f = list[idx]
				if (!f) return
				f.chatIds = [...new Set([...f.chatIds || [], gid])]
				await saveGroupFolders({ folders: list })
				await renderGroupFolders()
				return
			}
			const fromStr = e.dataTransfer.getData(FOLDER_REORDER_MIME)
			if (fromStr === '') return
			const from = Number(fromStr)
			if (from === idx || Number.isNaN(from)) return
			const next = [...list]
			const [moved] = next.splice(from, 1)
			const insertAt = from < idx ? idx - 1 : idx
			next.splice(insertAt, 0, moved)
			await saveGroupFolders({ folders: next })
			await renderGroupFolders()
		})

		const head = document.createElement('div')
		head.className = 'flex flex-wrap items-center gap-1 mb-1'
		const title = document.createElement('div')
		title.className = 'font-medium text-sm flex-1 min-w-0'
		title.textContent = folder.name || folder.id
		head.appendChild(title)
		const renameBtn = document.createElement('button')
		renameBtn.type = 'button'
		renameBtn.className = 'btn btn-xs btn-ghost'
		bindLocalize(renameBtn, text => {
			renameBtn.textContent = text
		}, 'chat_history.renameFolder')
		renameBtn.addEventListener('click', async () => {
			const next = globalThis.prompt(geti18n('chat_history.renameFolderPrompt'), folder.name || folder.id)
			if (!next?.trim()) return
			const fresh = await getGroupFolders()
			const list = [...fresh.folders || []]
			const f = list[idx]
			if (!f) return
			f.name = next.trim()
			if (await saveGroupFolders({ folders: list }))
				await renderGroupFolders()
			else handleUIError(new Error('saveGroupFolders failed'), 'chat_history.groupFoldersSaveFailed', 'saveGroupFolders (rename)')
		})
		head.appendChild(renameBtn)
		const colorBtn = document.createElement('button')
		colorBtn.type = 'button'
		colorBtn.className = 'btn btn-xs btn-ghost'
		bindLocalize(colorBtn, text => {
			colorBtn.title = text
			colorBtn.textContent = text
		}, 'chat_history.folderColorCycle')
		colorBtn.addEventListener('click', async () => {
			const order = ['neutral', 'primary', 'secondary', 'accent']
			const cur = order.includes(folder.color) ? folder.color : 'neutral'
			const ni = (order.indexOf(cur) + 1) % order.length
			const fresh = await getGroupFolders()
			const list = [...fresh.folders || []]
			const f = list[idx]
			if (!f) return
			f.color = order[ni]
			if (await saveGroupFolders({ folders: list }))
				await renderGroupFolders()
			else handleUIError(new Error('saveGroupFolders failed'), 'chat_history.groupFoldersSaveFailed', 'saveGroupFolders (color)')
		})
		head.appendChild(colorBtn)
		li.appendChild(head)
		const ul = document.createElement('ul')
		ul.className = 'text-xs space-y-0.5 pl-1'
		for (const cid of folder.chatIds || []) {
			const item = document.createElement('li')
			item.className = 'flex items-center gap-1 justify-between'
			const a = document.createElement('a')
			a.className = 'link link-hover truncate'
			a.href = `/parts/shells:chat/#group:${cid}:default`
			a.textContent = groupNameMap.get(cid) || cid
			a.title = cid
			item.appendChild(a)
			const removeBtn = document.createElement('button')
			removeBtn.type = 'button'
			removeBtn.className = 'btn btn-xs btn-ghost shrink-0'
			bindLocalize(removeBtn, text => {
				removeBtn.title = text
				removeBtn.setAttribute('aria-label', text)
			}, 'chat_history.removeFromFolder')
			removeBtn.textContent = '×'
			removeBtn.addEventListener('click', async () => {
				const fresh = await getGroupFolders()
				const list = [...fresh.folders || []]
				const f = list[idx]
				if (!f) return
				f.chatIds = (f.chatIds || []).filter(id => id !== cid)
				if (await saveGroupFolders({ folders: list }))
					await renderGroupFolders()
				else handleUIError(new Error('saveGroupFolders failed'), 'chat_history.groupFoldersSaveFailed', 'saveGroupFolders (remove)')
			})
			item.appendChild(removeBtn)
			ul.appendChild(item)
		}
		li.appendChild(ul)
		groupFoldersListEl.appendChild(li)
	})
}

/**
 * 渲染群组链接
 */
async function renderGroupLinks() {
	if (!groupLinksEl) return
	const { groups = [] } = await getGroupList()
	groupLinksEl.innerHTML = ''
	for (const { id: gid, name } of groups) {
		const li = document.createElement('li')
		const a = document.createElement('a')
		a.className = 'link link-primary'
		a.href = `/parts/shells:chat/#group:${gid}:default`
		a.textContent = name || gid
		bindLocalize(a, text => {
			a.title = text
		}, 'chat_history.openGroup')
		a.draggable = true
		a.addEventListener('dragstart', e => {
			e.dataTransfer.setData(GROUP_DRAG_MIME, gid)
			e.dataTransfer.effectAllowed = 'copy'
		})
		li.appendChild(a)
		groupLinksEl.appendChild(li)
	}
	if (!groups.length) {
		const li = document.createElement('li')
		li.className = 'opacity-60'
		li.textContent = '—'
		groupLinksEl.appendChild(li)
	}
}

newDmButton?.addEventListener('click', async () => {
	const r = await createDmRoom()
	if (r.groupId)
		globalThis.location.href = `/parts/shells:chat/#group:${r.groupId}:default`
	else handleUIError(new Error('createDmRoom failed'), 'chat.group.createFailed', 'createDmRoom')
})

document.getElementById('qr-transfer-button')?.addEventListener('click', async () => {
	const { showQrTransferModal } = await import('../src/qrTransferSender.mjs')
	showQrTransferModal().catch(e => {
		handleUIError(normalizeError(e), 'chat.group.qrTransferFetchFailed', 'showQrTransferModal')
	})
})

addGroupFolderBtn?.addEventListener('click', async () => {
	const name = globalThis.prompt(geti18n('chat_history.newFolderPrompt'), '')
	if (!name?.trim()) return
	const data = await getGroupFolders()
	const folders = Array.isArray(data.folders) ? [...data.folders] : []
	const id = `f_${Date.now().toString(36)}`
	folders.push({ id, name: name.trim(), chatIds: [] })
	if (await saveGroupFolders({ folders }))
		await renderGroupFolders()
	else handleUIError(new Error('saveGroupFolders failed'), 'chat_history.groupFoldersSaveFailed', 'saveGroupFolders (new folder)')
})

/**
 * 初始化应用程序
 */
async function initializeApp() {
	applyTheme()
	await initTranslations('chat_history')

	fullChatList = await getChatList()
	await renderGroupLinks()
	await renderGroupFolders()
	currentFilteredList = fullChatList

	makeSearchable({
		searchInput: filterInput,
		data: fullChatList,
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
		renderGroupLinks()
		renderGroupFolders()
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
			handleUIError(normalizeError(error), 'chat_history.alerts.importError', 'import chat (drag-drop)')
		}
	})
}

initializeApp().catch(error => {
	handleUIError(normalizeError(error), 'chat.group.loadError', 'chat list initializeApp')
	setTimeout(() => globalThis.location.href = '/shells/home', 5000)
})
