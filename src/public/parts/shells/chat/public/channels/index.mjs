import { initTranslations } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import {
	getChannelList,
	getChannel,
	createChannel,
	updateChannel,
	deleteChannel,
	subscribeToChannel,
	unsubscribeFromChannel,
	getChannelMessages,
	postChannelMessage
} from './src/endpoints.mjs'

let currentChannelId = null
let currentUser = null
let channels = []
let channelPollTimer = null
let lastMessageCount = 0

/**
 * 初始化频道页面
 */
async function init() {
	applyTheme()
	await initTranslations('channels')

	// 获取当前用户信息
	try {
		const response = await fetch('/api/user/me', {
			credentials: 'include'
		})
		if (response.ok) {
			const data = await response.json()
			currentUser = data.username
		}
	} catch (error) {
		console.error('Failed to get current user:', error)
	}

	setupEventListeners()
	await loadChannels()
	await loadMiniUserBar()
}

const EMOJI_DATA = {
	face: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐'],
	gesture: ['👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪'],
	heart: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','🫶','💏','💑','🫂'],
	animal: ['🐱','🐶','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜'],
	food: ['🍔','🍟','🍕','🌭','🥪','🌮','🌯','🥙','🥚','🍳','🥘','🍲','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🍦','🍧','🍨','🍩','🍪','🎂','🍰'],
	object: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥊','🥋','🎯','⛳','🥅','🏒','🏑','🏏','🪃','🎮','🎲','🧩','🎭','🎨','🎪','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎬','🏆','🥇','🥈','🥉']
}
let currentEmojiTab = 'face'
let stickersLoaded = false

/**
 * 设置事件监听器
 */
function setupEventListeners() {
	document.getElementById('create-channel-btn').addEventListener('click', () => {
		document.getElementById('create-channel-modal').showModal()
	})
	document.getElementById('create-channel-confirm').addEventListener('click', handleCreateChannel)
	document.getElementById('search-input').addEventListener('input', handleSearch)
	document.getElementById('subscribe-btn').addEventListener('click', handleSubscribe)
	document.getElementById('unsubscribe-btn').addEventListener('click', handleUnsubscribe)
	document.getElementById('send-message-btn').addEventListener('click', handleSendMessage)
	document.getElementById('message-input').addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSendMessage()
		}
	})

	// 成员列表切换
	document.getElementById('toggle-members-btn')?.addEventListener('click', () => {
		const sidebar = document.getElementById('member-sidebar')
		sidebar.classList.toggle('hidden')
		if (!sidebar.classList.contains('hidden')) loadChannelMembers()
	})

	// 表情选择器
	document.getElementById('ch-emoji-btn')?.addEventListener('click', (e) => {
		e.stopPropagation()
		const picker = document.getElementById('channel-emoji-picker')
		picker.classList.toggle('hidden')
		document.getElementById('channel-sticker-picker')?.classList.add('hidden')
		if (!picker.classList.contains('hidden')) renderEmojiGrid(currentEmojiTab)
	})
	document.getElementById('close-channel-emoji')?.addEventListener('click', () => {
		document.getElementById('channel-emoji-picker')?.classList.add('hidden')
	})
	document.getElementById('ch-emoji-tabs')?.addEventListener('click', (e) => {
		const tab = e.target.closest('[data-tab]')
		if (!tab) return
		currentEmojiTab = tab.dataset.tab
		document.querySelectorAll('#ch-emoji-tabs .tab').forEach(t => t.classList.remove('tab-active'))
		tab.classList.add('tab-active')
		renderEmojiGrid(currentEmojiTab)
	})
	document.getElementById('ch-emoji-grid')?.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-emoji]')
		if (!btn) return
		const input = document.getElementById('message-input')
		if (input) {
			const start = input.selectionStart || input.value.length
			input.value = input.value.substring(0, start) + btn.dataset.emoji + input.value.substring(start)
			input.focus()
		}
		document.getElementById('channel-emoji-picker')?.classList.add('hidden')
	})

	// 贴纸选择器
	document.getElementById('ch-sticker-btn')?.addEventListener('click', (e) => {
		e.stopPropagation()
		const picker = document.getElementById('channel-sticker-picker')
		picker.classList.toggle('hidden')
		document.getElementById('channel-emoji-picker')?.classList.add('hidden')
		if (!picker.classList.contains('hidden')) loadChannelStickers()
	})
	document.getElementById('close-channel-sticker')?.addEventListener('click', () => {
		document.getElementById('channel-sticker-picker')?.classList.add('hidden')
	})

	// 图片上传
	document.getElementById('ch-image-btn')?.addEventListener('click', () => {
		document.getElementById('ch-image-upload')?.click()
	})
	document.getElementById('ch-image-upload')?.addEventListener('change', handleImageUpload)

	// 频道设置按钮
	document.getElementById('channel-settings-btn')?.addEventListener('click', openChannelSettings)
	document.getElementById('save-channel-settings-btn')?.addEventListener('click', handleSaveChannelSettings)
	document.getElementById('delete-channel-btn')?.addEventListener('click', handleDeleteChannel)

	// 加入频道按钮
	document.getElementById('join-channel-btn')?.addEventListener('click', () => {
		document.getElementById('join-channel-modal').showModal()
	})
	document.getElementById('join-channel-confirm')?.addEventListener('click', handleJoinChannelById)

	// 点击外部关闭弹出窗
	document.addEventListener('click', (e) => {
		const emojiPicker = document.getElementById('channel-emoji-picker')
		if (emojiPicker && !emojiPicker.contains(e.target) && !e.target.closest('#ch-emoji-btn'))
			emojiPicker.classList.add('hidden')
		const stickerPicker = document.getElementById('channel-sticker-picker')
		if (stickerPicker && !stickerPicker.contains(e.target) && !e.target.closest('#ch-sticker-btn'))
			stickerPicker.classList.add('hidden')
	})
}

/**
 * 按分类渲染表情网格
 * @param {string} tab - 表情分类标签（如 face、gesture）
 * @returns {void} - 无
 */
function renderEmojiGrid(tab) {
	const grid = document.getElementById('ch-emoji-grid')
	if (!grid) return
	const emojis = EMOJI_DATA[tab] || []
	grid.innerHTML = emojis.map(e =>
		`<button type="button" class="btn btn-ghost btn-sm text-xl hover:scale-125 transition-transform" data-emoji="${e}">${e}</button>`
	).join('')
}

/**
 * 加载频道贴纸选择器数据
 * @returns {Promise<void>} - 无
 */
async function loadChannelStickers() {
	const grid = document.getElementById('ch-sticker-grid')
	if (stickersLoaded) return
	stickersLoaded = true
	try {
		const meResp = await fetch('/api/user/me', { credentials: 'include' })
		if (!meResp.ok) throw new Error('Failed to fetch user')
		const me = await meResp.json()
		const username = me.username || me.data?.username
		if (!username) throw new Error('No username')

		const collResp = await fetch(`/api/parts/shells:chat/stickers/user/${encodeURIComponent(username)}`, { credentials: 'include' })
		if (!collResp.ok) throw new Error('Failed to fetch sticker collection')
		const collData = await collResp.json()
		if (!collData.success) throw new Error(collData.error || 'Failed')

		const packs = collData.collection?.installedPacks || []
		if (!packs.length) { grid.innerHTML = '<div class="text-center py-4 col-span-4 opacity-50 text-sm">暂无可用贴纸</div>'; return }

		const allStickers = []
		for (const packId of packs) 
			try {
				const packResp = await fetch(`/api/parts/shells:chat/stickers/packs/${encodeURIComponent(packId)}`, { credentials: 'include' })
				if (!packResp.ok) continue
				const packData = await packResp.json()
				if (packData.success && packData.pack?.stickers) allStickers.push(...packData.pack.stickers)
			} catch { }
		

		if (!allStickers.length) { grid.innerHTML = '<div class="text-center py-4 col-span-4 opacity-50 text-sm">暂无可用贴纸</div>'; return }

		grid.innerHTML = allStickers.map(s => `
			<div class="aspect-square bg-base-300 rounded-lg p-1 hover:bg-base-100 transition-colors cursor-pointer sticker-pick-item"
				 data-sticker-id="${s.id}" data-sticker-url="${escapeHtml(s.url || '')}" title="${escapeHtml(s.name || s.id)}">
				${s.url ? `<img src="${escapeHtml(s.url)}" alt="${escapeHtml(s.name || '')}" class="w-full h-full object-contain" />` : '<span class="text-2xl flex items-center justify-center h-full">📦</span>'}
			</div>
		`).join('')

		grid.addEventListener('click', async (e) => {
			const item = e.target.closest('.sticker-pick-item')
			if (!item || !currentChannelId) return
			const stickerId = item.dataset.stickerId
			const stickerUrl = item.dataset.stickerUrl
			const tag = stickerUrl ? `[sticker:${stickerId}|${stickerUrl}]` : `[sticker:${stickerId}]`
			try {
				await postChannelMessage(currentChannelId, { content: tag })
				await loadMessages(currentChannelId)
				document.getElementById('channel-sticker-picker')?.classList.add('hidden')
			} catch (err) { showToast('error', '发送贴纸失败: ' + err.message) }
		})
	} catch (err) {
		stickersLoaded = false
		grid.innerHTML = '<div class="text-center py-4 col-span-4 opacity-50 text-sm">加载贴纸失败</div>'
	}
}

/**
 * 处理图片上传并作为消息发送
 * @param {Event} e - 文件选择 change 事件
 * @returns {Promise<void>} - 无
 */
async function handleImageUpload(e) {
	const file = e.target.files[0]
	if (!file || !currentChannelId) return
	e.target.value = ''
	try {
		const reader = new FileReader()
		const dataUrl = await new Promise((resolve, reject) => {
			/**
			 * FileReader 读取完成回调
			 * @returns {void} - 无（通过 resolve 传递 data URL）
			 */
			reader.onload = () => resolve(reader.result)
			reader.onerror = reject
			reader.readAsDataURL(file)
		})
		const tag = `[image:${file.name}|${dataUrl}]`
		await postChannelMessage(currentChannelId, { content: tag })
		await loadMessages(currentChannelId)
	} catch (err) { showToast('error', '发送图片失败: ' + err.message) }
}

/**
 * 根据用户名生成稳定的头像背景色
 * @param {string} name - 用户名或显示名
 * @returns {string} - CSS 颜色值
 */
function avatarColor(name) {
	const colors = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899']
	let hash = 0
	for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
	return colors[Math.abs(hash) % colors.length]
}

/**
 *
 */
async function loadChannelMembers() {
	const container = document.getElementById('channel-member-list')
	if (!container || !currentChannelId) return
	try {
		const resp = await fetch(`/api/parts/shells:chat/channels/${currentChannelId}/members`, { credentials: 'include' })
		const data = await resp.json()
		if (!data.success || !data.members?.length) {
			container.innerHTML = '<p class="text-sm opacity-50">暂无成员</p>'
			return
		}
		container.innerHTML = data.members.map(m => {
			const uname = m.username || '?'
			const initial = uname.charAt(0).toUpperCase()
			const color = avatarColor(uname)
			const roleLabel = m.role === 'owner' ? '创建者' : m.role === 'admin' ? '管理员' : '订阅者'
			return `
			<div class="flex items-center gap-2 p-2 rounded hover:bg-base-300" data-member-row="${escapeHtml(uname)}">
				<div class="relative flex-shrink-0">
					<div class="rounded-full w-8 h-8 flex items-center justify-center text-white font-bold overflow-hidden" data-avatar-for="${escapeHtml(uname)}" style="background:${color}">
						<span class="text-xs">${escapeHtml(initial)}</span>
					</div>
					<span class="presence-dot presence-offline" data-presence-for="${escapeHtml(uname)}" title="离线"></span>
				</div>
				<div class="min-w-0 flex-1">
					<div class="text-sm font-medium truncate">${escapeHtml(uname)}</div>
					<div class="text-xs opacity-50">
						<span data-presence-label-for="${escapeHtml(uname)}">离线</span>
						<span class="opacity-60"> · ${roleLabel}</span>
					</div>
				</div>
			</div>`
		}).join('')

		// 异步加载真实头像
		container.querySelectorAll('[data-avatar-for]').forEach(el => {
			const uname = el.dataset.avatarFor
			if (!uname || el.dataset.avatarLoaded) return
			el.dataset.avatarLoaded = '1'
			fetchUserAvatar(uname).then(avatar => {
				if (avatar) el.innerHTML = `<img src="${avatar}" alt="${escapeHtml(uname)}" style="width:100%;height:100%;object-fit:cover;" />`
			})
		})

		// 加载在线状态并启动定时刷新
		const usernames = data.members.map(m => m.username).filter(Boolean)
		await applyPresence(container, usernames)
		startMemberPresencePolling(container, usernames)
	} catch { container.innerHTML = '<p class="text-sm opacity-50">加载失败</p>' }
}

/**
 * 加载频道列表
 */
async function loadChannels() {
	try {
		const response = await getChannelList()
		if (response.success) {
			channels = response.channels
			renderChannelList(channels)
		}
	} catch (error) {
		console.error('Failed to load channels:', error)
		showToast('error', '加载频道列表失败')
	}
}

/**
 * 渲染频道列表
 * @param {Array} channelList - 频道列表
 */
function renderChannelList(channelList) {
	const container = document.getElementById('channel-list')
	container.innerHTML = ''

	if (channelList.length === 0) {
		container.innerHTML = '<p class="text-center opacity-50">暂无频道</p>'
		return
	}

	channelList.forEach(channel => {
		const item = document.createElement('div')
		item.className = 'channel-item p-3 rounded-lg cursor-pointer hover:bg-base-300'
		item.dataset.channelId = channel.channelId

		if (currentChannelId === channel.channelId) 
			item.classList.add('active')
		

		item.innerHTML = `
			<div class="flex items-center gap-3">
				<div class="avatar">
					<div class="w-10 h-10 rounded-full bg-primary text-primary-content flex items-center justify-center">
						${channel.avatar ? `<img src="${channel.avatar}" alt="${channel.name}" class="channel-avatar" />` : `<span>${channel.name.charAt(0).toUpperCase()}</span>`}
					</div>
				</div>
				<div class="flex-1 min-w-0">
					<h3 class="font-semibold truncate">${escapeHtml(channel.name)}</h3>
					<p class="text-xs opacity-70 truncate">${escapeHtml(channel.description || '')}</p>
				</div>
				<div class="badge badge-sm">${channel.type}</div>
			</div>
		`

		item.addEventListener('click', () => loadChannel(channel.channelId))
		container.appendChild(item)
	})
}

/**
 * 加载频道详情
 * @param {string} channelId - 频道ID
 */
async function loadChannel(channelId) {
	stopChannelPolling()
	try {
		const response = await getChannel(channelId)
		if (response.success) {
			currentChannelId = channelId
			renderChannelHeader(response.channel)
			await loadMessages(channelId)

			document.querySelectorAll('.channel-item').forEach(item => {
				item.classList.toggle('active', item.dataset.channelId === channelId)
			})

			// 如果成员面板可见则刷新
			const sidebar = document.getElementById('member-sidebar')
			if (sidebar && !sidebar.classList.contains('hidden')) loadChannelMembers()
		}
	} catch (error) {
		console.error('Failed to load channel:', error)
		showToast('error', '加载频道失败')
	}
}

/**
 * 渲染频道头部
 * @param {object} channel - 频道信息
 */
function renderChannelHeader(channel) {
	const header = document.getElementById('channel-header')
	const avatar = document.getElementById('channel-avatar')
	const name = document.getElementById('channel-name')
	const description = document.getElementById('channel-description')
	const subscribeBtn = document.getElementById('subscribe-btn')
	const unsubscribeBtn = document.getElementById('unsubscribe-btn')
	const settingsBtn = document.getElementById('channel-settings-btn')
	const messageInputContainer = document.getElementById('message-input-container')

	header.classList.remove('hidden')
	document.getElementById('empty-state').classList.add('hidden')

	// 设置头像
	if (channel.avatar) {
		avatar.src = channel.avatar
		avatar.parentElement.classList.remove('hidden')
	} else 
		avatar.parentElement.classList.add('hidden')
	

	name.textContent = channel.name
	description.textContent = channel.description || ''

	// 显示/隐藏订阅按钮
	const isSubscribed = channel.subscribers.includes(currentUser)
	subscribeBtn.classList.toggle('hidden', isSubscribed)
	unsubscribeBtn.classList.toggle('hidden', !isSubscribed || channel.owner === currentUser)

	// 显示/隐藏设置按钮（仅所有者和管理员）
	const isAdmin = channel.owner === currentUser || channel.admins.includes(currentUser)
	settingsBtn.classList.toggle('hidden', !isAdmin)

	// 显示/隐藏消息输入框（订阅者和管理员都可以发送消息）
	const isSubscriber = channel.subscribers.includes(currentUser)
	const canPost = isSubscriber || isAdmin
	messageInputContainer.classList.toggle('hidden', !canPost)
}

/**
 * 加载消息列表
 * @param {string} channelId - 频道ID
 */
async function loadMessages(channelId) {
	try {
		const response = await getChannelMessages(channelId)
		if (response.success) {
			lastMessageCount = response.messages.length
			renderMessages(response.messages)
			startChannelPolling(channelId)
		}
	} catch (error) {
		console.error('Failed to load messages:', error)
		showToast('error', '加载消息失败')
	}
}

/**
 * 启动频道消息轮询
 * @param {string} channelId - 频道 ID
 * @returns {void} - 无
 */
function startChannelPolling(channelId) {
	stopChannelPolling()
	channelPollTimer = setInterval(() => pollChannelMessages(channelId), 3000)
}

/**
 *
 */
function stopChannelPolling() {
	if (channelPollTimer) {
		clearInterval(channelPollTimer)
		channelPollTimer = null
	}
}

/**
 * 轮询拉取频道最新消息并刷新 UI
 * @param {string} channelId - 频道 ID
 * @returns {Promise<void>} - 无
 */
async function pollChannelMessages(channelId) {
	if (!channelId || channelId !== currentChannelId) {
		stopChannelPolling()
		return
	}
	try {
		const response = await getChannelMessages(channelId, 0, 200)
		if (response.success && response.messages.length !== lastMessageCount) {
			lastMessageCount = response.messages.length
			renderMessages(response.messages)
		}
	} catch { }
}

/**
 * 渲染富文本内容（sticker/image 标签）
 * @param {string} text - 原始消息文本
 * @returns {string} - 可插入 DOM 的 HTML 字符串
 */
function renderRichContent(text) {
	let html = escapeHtml(text)
	html = html.replace(/\[sticker:([^\]|]+)\|([^\]]+)\]/g, (_, id, url) => {
		const safeUrl = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
		return `<img src="${safeUrl}" alt="sticker" style="max-width:120px;max-height:120px;border-radius:8px;display:inline-block" />`
	})
	html = html.replace(/\[sticker:([^\]]+)\]/g, () =>
		'<span style="display:inline-block;padding:2px 8px;background:var(--b3,#333);border-radius:4px;font-size:0.875rem;opacity:0.7">🖼️ 贴纸</span>'
	)
	html = html.replace(/\[image:([^\]|]+)\|([^\]]+)\]/g, (_, name, url) => {
		const safeUrl = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
		return `<img src="${safeUrl}" alt="${name}" style="max-width:300px;max-height:300px;border-radius:8px;display:block;margin:4px 0;cursor:pointer" onclick="window.open('${safeUrl}','_blank')" />`
	})
	return html
}

// 头像缓存：username -> avatar URL（null 表示无头像）
const avatarCache = new Map()
/**
 * 获取用户头像 URL（带缓存）
 * @param {string} username - 用户名
 * @returns {Promise<string|null>} - 头像地址；无则 null
 */
async function fetchUserAvatar(username) {
	if (avatarCache.has(username)) return avatarCache.get(username)
	try {
		const resp = await fetch(`/api/parts/shells:chat/profile/${encodeURIComponent(username)}`, { credentials: 'include' })
		if (!resp.ok) { avatarCache.set(username, null); return null }
		const data = await resp.json()
		const avatar = data?.profile?.avatar || data?.data?.avatar || data?.avatar || null
		avatarCache.set(username, avatar || null)
		return avatar || null
	} catch { avatarCache.set(username, null); return null }
}

// 在线状态批量查询
/**
 * 批量查询用户在线状态
 * @param {string[]} usernames - 用户名列表
 * @returns {Promise<Object<string, Object>>} - 用户名到状态对象的映射
 */
async function fetchBulkPresence(usernames) {
	if (!usernames?.length) return {}
	try {
		const url = '/api/presence?users=' + encodeURIComponent(usernames.join(','))
		const resp = await fetch(url, { credentials: 'include' })
		if (!resp.ok) return {}
		const data = await resp.json()
		return data?.statuses || {}
	} catch { return {} }
}

// 定时心跳：每 30 秒一次
setInterval(() => {
	fetch('/api/presence/ping', { method: 'POST', credentials: 'include' }).catch(() => { })
}, 30 * 1000)

const PRESENCE_LABEL = { online: '在线', idle: '挂起', offline: '离线' }
/**
 * 将在线状态应用到 DOM 上的状态点与文案
 * @param {HTMLElement} rootEl - 成员列表等根容器
 * @param {string[]} usernames - 需要更新的用户名列表
 * @returns {Promise<void>} - 无
 */
async function applyPresence(rootEl, usernames) {
	if (!usernames?.length) return
	const statuses = await fetchBulkPresence(usernames)
	for (const uname of usernames) {
		const info = statuses[uname] || { status: 'offline' }
		const dot = rootEl.querySelector(`.presence-dot[data-presence-for="${CSS.escape(uname)}"]`)
		if (dot) {
			dot.classList.remove('presence-online', 'presence-idle', 'presence-offline')
			dot.classList.add(`presence-${info.status}`)
			dot.title = PRESENCE_LABEL[info.status] || '离线'
		}
		const label = rootEl.querySelector(`[data-presence-label-for="${CSS.escape(uname)}"]`)
		if (label) label.textContent = PRESENCE_LABEL[info.status] || '离线'
	}
}

let _memberPresenceTimer = null
/**
 * 定时刷新成员在线状态
 * @param {HTMLElement} rootEl - 成员列表根容器
 * @param {string[]} usernames - 用户名列表
 * @returns {void} - 无
 */
function startMemberPresencePolling(rootEl, usernames) {
	if (_memberPresenceTimer) clearInterval(_memberPresenceTimer)
	_memberPresenceTimer = setInterval(() => {
		// 若容器已不在 DOM，停止轮询
		if (!document.body.contains(rootEl)) { clearInterval(_memberPresenceTimer); _memberPresenceTimer = null; return }
		applyPresence(rootEl, usernames)
	}, 20 * 1000)
}

// 注入状态点 + 系统消息样式（一次性）
if (!document.getElementById('presence-dot-style')) {
	const style = document.createElement('style')
	style.id = 'presence-dot-style'
	style.textContent = `
		.presence-dot {
			position: absolute; right: -2px; bottom: -2px;
			width: 12px; height: 12px; border-radius: 50%;
			border: 2px solid var(--dc-bg-channel, #2b2d31);
			background: #80848e;
			box-sizing: border-box;
		}
		.presence-online { background: #23a55a; }
		.presence-idle { background: #f0b232; }
		.presence-offline { background: #80848e; }

		/* 系统消息（入群欢迎） */
		.channel-system-message {
			padding: 6px 16px 6px 72px;
			color: var(--dc-text-muted, #949ba4);
			font-size: 14px;
			display: flex;
			align-items: center;
			gap: 8px;
			position: relative;
		}
		.channel-system-message::before {
			content: '';
			position: absolute;
			left: 32px; top: 50%;
			transform: translateY(-50%);
			width: 22px; height: 22px;
			background: #23a55a;
			border-radius: 50%;
			-webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'><path d='M12 2a10 10 0 100 20 10 10 0 000-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z'/></svg>") center/14px no-repeat;
			        mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'><path d='M12 2a10 10 0 100 20 10 10 0 000-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z'/></svg>") center/14px no-repeat;
		}
		.channel-system-author { color: var(--dc-text-bright, #fff); font-weight: 600; }
		.channel-system-time { color: var(--dc-text-muted, #949ba4); font-size: 12px; margin-left: 6px; }
	`
	document.head.appendChild(style)
}

// 解析入群欢迎消息：[join:greeting]
/**
 * 解析入群欢迎占位消息正文
 * @param {string} text - 消息文本
 * @returns {string|null} - 欢迎语内容；不匹配则为 null
 */
function parseJoinMessage(text) {
	const m = String(text || '').match(/^\[join:([^\]]+)\]$/)
	return m ? m[1] : null
}

// 入群欢迎语选择器
const JOIN_GREETINGS = [
	'跳进了服务器', '神秘登场', '闪亮登场了', '空降到此', '来串门了',
	'加入了狂欢', '刚刚降落', '潜入了对话', '🎉 闯入了！', '正式加入'
]
/**
 * 展示入群欢迎语选择弹窗
 * @returns {Promise<string|null>} - 选中的欢迎语；跳过或关闭为 null
 */
function showGreetingPicker() {
	return new Promise(resolve => {
		const modal = document.createElement('dialog')
		modal.className = 'modal'
		modal.innerHTML = `
			<style>
				.gp-box { background:#2b2d31; color:#dbdee1; border-radius:12px; max-width:480px; width:100%; padding:0; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
				.gp-header { background:linear-gradient(135deg,#5865f2 0%,#4752c4 100%); padding:24px; color:white; text-align:center; }
				.gp-header h3 { font-size:20px; font-weight:700; margin:0 0 4px; }
				.gp-header p { font-size:13px; opacity:0.85; margin:0; }
				.gp-body { padding:18px; }
				.gp-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
				.gp-item { background:#1e1f22; border:1.5px solid transparent; color:#dbdee1; padding:14px 12px; border-radius:8px; cursor:pointer; font-size:14px; font-weight:500; font-family:inherit; transition:all 0.15s; text-align:center; }
				.gp-item:hover { border-color:#5865f2; background:rgba(88,101,242,0.12); transform:translateY(-1px); }
				.gp-footer { padding:0 18px 16px; display:flex; justify-content:flex-end; }
				.gp-skip { background:transparent; color:#b5bac1; border:none; cursor:pointer; padding:8px 16px; font-size:13px; font-weight:600; border-radius:6px; font-family:inherit; }
				.gp-skip:hover { background:rgba(255,255,255,0.06); color:#fff; }
			</style>
			<div class="modal-box gp-box">
				<div class="gp-header">
					<h3>👋 选择你的入场宣言</h3>
					<p>让大家看看你的入场风格</p>
				</div>
				<div class="gp-body">
					<div class="gp-grid">
						${JOIN_GREETINGS.map(g => `<button class="gp-item" data-g="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
					</div>
				</div>
				<div class="gp-footer">
					<button class="gp-skip" data-skip>低调登场（跳过）</button>
				</div>
			</div>
			<form method="dialog" class="modal-backdrop"><button>关闭</button></form>
		`
		/**
		 * 关闭欢迎语弹窗并结束 Promise
		 * @param {string|null} val - 选中的欢迎语或 null
		 * @returns {void} - 无
		 */
		const close = (val) => { resolve(val); try { modal.close() } catch { } modal.remove() }
		modal.querySelectorAll('.gp-item').forEach(b => b.addEventListener('click', () => close(b.dataset.g)))
		modal.querySelector('[data-skip]').addEventListener('click', () => close(null))
		modal.addEventListener('close', () => close(null))
		document.body.appendChild(modal)
		modal.showModal()
	})
}

/**
 * 气泡列表头像占位色
 * @param {string} name - 作者名
 * @returns {string} - CSS 颜色值
 */
function bubbleAvatarColor(name) {
	const colors = ['#5865f2', '#ed4245', '#fee75c', '#57f287', '#eb459e', '#f0b232', '#9b59b6', '#1abc9c']
	let hash = 0
	for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
	return colors[Math.abs(hash) % colors.length]
}

/**
 * 格式化气泡消息时间展示
 * @param {string|number|Date} ts - 消息时间戳或可解析时间
 * @returns {string} - 本地化时间文案
 */
function formatBubbleTime(ts) {
	const d = new Date(ts)
	const now = new Date()
	const isToday = d.toDateString() === now.toDateString()
	const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
	const isYesterday = d.toDateString() === yesterday.toDateString()
	const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
	if (isToday) return `今天 ${time}`
	if (isYesterday) return `昨天 ${time}`
	return d.toLocaleDateString('zh-CN') + ' ' + time
}

/**
 * 渲染消息列表（气泡式布局）
 * @param {Array<Object>} messages - 消息对象列表
 * @returns {void} - 无
 */
function renderMessages(messages) {
	const container = document.getElementById('messages-list')
	const emptyState = document.getElementById('empty-state')
	container.innerHTML = ''

	if (messages.length === 0) {
		emptyState?.classList.remove('hidden')
		return
	}
	emptyState?.classList.add('hidden')

	let prevAuthor = null
	let prevTime = 0

	messages.forEach(message => {
		const author = message.author || '?'
		const time = new Date(message.createdAt).getTime() || 0

		// 系统消息（入群欢迎）特殊渲染
		const joinGreeting = parseJoinMessage(message.content)
		if (joinGreeting) {
			const sysItem = document.createElement('div')
			sysItem.className = 'channel-system-message'
			sysItem.innerHTML = `
				<span><span class="channel-system-author">${escapeHtml(author)}</span> ${escapeHtml(joinGreeting)}</span>
				<span class="channel-system-time">${escapeHtml(formatBubbleTime(message.createdAt))}</span>
			`
			container.appendChild(sysItem)
			prevAuthor = null
			prevTime = 0
			return
		}

		const isFirst = author !== prevAuthor || (time - prevTime) > 5 * 60 * 1000
		prevAuthor = author
		prevTime = time

		const item = document.createElement('div')
		item.className = `dc-message ${isFirst ? 'first-in-group' : ''}`
		item.dataset.author = author

		const initial = (author.charAt(0) || '?').toUpperCase()
		const color = bubbleAvatarColor(author)
		const timeStr = formatBubbleTime(message.createdAt)

		item.innerHTML = `
			<div class="dc-avatar" style="background: ${color};" data-avatar-for="${escapeHtml(author)}">${escapeHtml(initial)}</div>
			<div class="dc-message-body">
				<div class="dc-message-header">
					<span class="dc-message-author">${escapeHtml(author)}</span>
					<span class="dc-message-time">${timeStr}</span>
					${message.isPinned ? '<span class="pinned-badge">置顶</span>' : ''}
				</div>
				<div class="dc-message-content">${renderRichContent(message.content)}</div>
				${message.files && message.files.length > 0 ? renderFiles(message.files) : ''}
			</div>
		`
		container.appendChild(item)

		// 异步加载头像（仅 first-in-group 真正显示头像）
		if (isFirst) fetchUserAvatar(author).then(avatar => {
			if (avatar) {
				const av = item.querySelector('.dc-avatar')
				if (av) av.innerHTML = `<img src="${avatar}" alt="${escapeHtml(author)}" />`
			}
		})
	})

	container.parentElement.scrollTop = container.parentElement.scrollHeight
}

/**
 * 渲染文件列表
 * @param {Array<Object>} files - 附件对象列表（含 url、name）
 * @returns {string} - 文件列表 HTML 片段
 */
function renderFiles(files) {
	return `
		<div class="mt-2 space-y-1">
			${files.map(file => `
				<a href="${file.url}" target="_blank" class="flex items-center gap-2 text-sm text-primary hover:underline">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
					</svg>
					${escapeHtml(file.name)}
				</a>
			`).join('')}
		</div>
	`
}

/**
 * 处理创建频道
 */
async function handleCreateChannel() {
	const name = document.getElementById('new-channel-name').value.trim()
	const description = document.getElementById('new-channel-description').value.trim()
	const type = document.getElementById('new-channel-type').value
	const isPublic = document.getElementById('new-channel-public').checked

	if (!name) {
		showToast('error', '请输入频道名称')
		return
	}

	try {
		const response = await createChannel({
			name,
			description,
			type,
			permissions: {
				isPublic
			}
		})

		if (response.success) {
			showToast('success', '频道创建成功')
			document.getElementById('create-channel-modal').close()

			// 清空表单
			document.getElementById('new-channel-name').value = ''
			document.getElementById('new-channel-description').value = ''
			document.getElementById('new-channel-type').value = 'announcement'
			document.getElementById('new-channel-public').checked = true

			// 重新加载频道列表
			await loadChannels()

			// 自动打开新创建的频道
			if (response.channel) 
				await loadChannel(response.channel.channelId)
			
		}
	} catch (error) {
		console.error('Failed to create channel:', error)
		showToast('error', '创建频道失败')
	}
}

/**
 * 处理搜索
 * @param {Event} e - 输入事件
 */
function handleSearch(e) {
	const query = e.target.value.toLowerCase().trim()

	if (!query) {
		renderChannelList(channels)
		return
	}

	const filtered = channels.filter(channel =>
		channel.name.toLowerCase().includes(query) ||
		channel.description.toLowerCase().includes(query)
	)

	renderChannelList(filtered)
}

/**
 * 处理订阅
 */
async function handleSubscribe() {
	if (!currentChannelId) return

	try {
		// 弹出打招呼选择器（首次订阅）
		const greeting = await showGreetingPicker()
		const response = await subscribeToChannel(currentChannelId, greeting)
		if (response.success) {
			showToast('success', '订阅成功')
			await loadChannel(currentChannelId)
			await loadChannels()
		}
	} catch (error) {
		console.error('Failed to subscribe:', error)
		showToast('error', '订阅失败')
	}
}

/**
 * 处理取消订阅
 */
async function handleUnsubscribe() {
	if (!currentChannelId) return

	try {
		const response = await unsubscribeFromChannel(currentChannelId)
		if (response.success) {
			showToast('success', '取消订阅成功')
			await loadChannel(currentChannelId)
			await loadChannels()
		}
	} catch (error) {
		console.error('Failed to unsubscribe:', error)
		showToast('error', '取消订阅失败')
	}
}

/**
 * 处理发送消息
 */
async function handleSendMessage() {
	if (!currentChannelId) return

	const input = document.getElementById('message-input')
	const content = input.value.trim()

	if (!content) {
		showToast('error', '请输入消息内容')
		return
	}

	try {
		const response = await postChannelMessage(currentChannelId, { content })
		if (response.success) {
			input.value = ''
			await loadMessages(currentChannelId)
		}
	} catch (error) {
		console.error('Failed to send message:', error)
		showToast('error', '发送消息失败')
	}
}

/**
 * 打开频道设置
 */
async function openChannelSettings() {
	if (!currentChannelId) return
	try {
		const response = await getChannel(currentChannelId)
		if (!response.success) return
		const ch = response.channel
		document.getElementById('settings-channel-name').value = ch.name || ''
		document.getElementById('settings-channel-desc').value = ch.description || ''
		document.getElementById('settings-channel-type').value = ch.type || 'announcement'
		document.getElementById('settings-channel-public').checked = ch.permissions?.isPublic ?? true
		document.getElementById('settings-channel-id').textContent = ch.channelId
		document.getElementById('channel-settings-modal').showModal()
	} catch (error) {
		console.error('Failed to load channel settings:', error)
		showToast('error', '加载频道设置失败')
	}
}

/**
 * 保存频道设置
 */
async function handleSaveChannelSettings() {
	if (!currentChannelId) return
	const name = document.getElementById('settings-channel-name').value.trim()
	const description = document.getElementById('settings-channel-desc').value.trim()
	const type = document.getElementById('settings-channel-type').value
	const isPublic = document.getElementById('settings-channel-public').checked
	if (!name) { showToast('error', '请输入频道名称'); return }
	try {
		const response = await updateChannel(currentChannelId, { name, description, type, permissions: { isPublic } })
		if (response.success) {
			showToast('success', '频道设置已保存')
			document.getElementById('channel-settings-modal').close()
			await loadChannels()
			await loadChannel(currentChannelId)
		} else 
			showToast('error', response.error || '保存失败')
		
	} catch (error) {
		console.error('Save channel settings error:', error)
		showToast('error', '保存频道设置失败')
	}
}

/**
 * 删除频道
 */
async function handleDeleteChannel() {
	if (!currentChannelId) return
	if (!confirm('确定要删除此频道吗？此操作不可撤销，所有消息将被永久删除。')) return
	try {
		const response = await deleteChannel(currentChannelId)
		if (response.success) {
			showToast('success', '频道已删除')
			document.getElementById('channel-settings-modal').close()
			currentChannelId = null
			document.getElementById('channel-header').classList.add('hidden')
			document.getElementById('message-input-container').classList.add('hidden')
			document.getElementById('empty-state').classList.remove('hidden')
			document.getElementById('messages-list').innerHTML = ''
			document.getElementById('member-sidebar').classList.add('hidden')
			await loadChannels()
		} else 
			showToast('error', response.error || '删除失败')
		
	} catch (error) {
		console.error('Delete channel error:', error)
		showToast('error', '删除频道失败')
	}
}

/**
 * 通过频道ID加入频道
 */
async function handleJoinChannelById() {
	const input = document.getElementById('join-channel-id-input')
	const channelId = input.value.trim()
	if (!channelId) { showToast('error', '请输入频道ID'); return }
	try {
		const greeting = await showGreetingPicker()
		const response = await subscribeToChannel(channelId, greeting)
		if (response.success) {
			showToast('success', '加入频道成功')
			input.value = ''
			document.getElementById('join-channel-modal').close()
			await loadChannels()
			await loadChannel(channelId)
		} else 
			showToast('error', response.error || '加入失败')
		
	} catch (error) {
		console.error('Join channel error:', error)
		showToast('error', '加入频道失败: ' + error.message)
	}
}

/**
 * 侧栏底部：当前登录用户名与头像。
 */
async function loadMiniUserBar() {
	try {
		const meResp = await fetch('/api/user/me', { credentials: 'include' })
		if (!meResp.ok) return
		const me = await meResp.json()
		const username = me.username || me.data?.username
		if (!username) return
		document.getElementById('my-name-mini').textContent = username

		const profResp = await fetch(`/api/parts/shells:chat/profile/${encodeURIComponent(username)}`, { credentials: 'include' })
		if (!profResp.ok) return
		const profData = await profResp.json()
		const avatar = profData?.profile?.avatar || profData?.data?.avatar || profData?.avatar
		const av = document.getElementById('my-avatar-mini')
		if (avatar)
			av.innerHTML = `<img src="${avatar}" alt="${username}" />`
		else
			av.textContent = (username.charAt(0) || '?').toUpperCase()
	} catch { }
}

/**
 * 转义HTML
 * @param {string} text - 文本
 * @returns {string} - 转义后的安全文本
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

init()
