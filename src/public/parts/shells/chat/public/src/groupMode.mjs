/**
 * 群组模式前端逻辑
 * 处理群组聊天的 UI 交互
 */

let currentGroupId = null
let currentChannelId = null
let currentState = null
let pollTimer = null
let lastMessageId = null

/**
 * 初始化群组模式
 */
export async function initGroupMode() {
	// 从 URL hash 解析群组和频道
	parseHashAndLoad()

	// 监听 hash 变化
	window.addEventListener('hashchange', parseHashAndLoad)

	// 设置事件监听器
	setupEventListeners()
}

/**
 * 解析 URL hash 并加载群组
 */
async function parseHashAndLoad() {
	const hash = window.location.hash.slice(1)

	if (hash.startsWith('group:')) {
		const parts = hash.split(':')
		const groupId = parts[1]
		const channelId = parts[2] || null

		await loadGroup(groupId, channelId)
	}
}

/**
 * 加载群组
 * @param {string} groupId - 群组ID
 * @param {string} channelId - 频道ID
 */
async function loadGroup(groupId, channelId = null) {
	try {
		// 获取群组状态
		const response = await fetch(`/api/parts/shells:chat/${groupId}/state`, {
			credentials: 'include'
		})

		if (!response.ok) {
			throw new Error('Failed to load group')
		}

		const data = await response.json()
		if (!data.success) {
			throw new Error(data.error)
		}

		currentGroupId = groupId
		currentState = data.state

		// 如果没有指定频道，使用默认频道
		if (!channelId) {
			channelId = currentState.groupSettings.defaultChannelId
		}

		currentChannelId = channelId

		// 渲染群组界面
		renderGroupUI()

		// 加载频道消息
		await loadChannelMessages(channelId)
		startPolling()
	} catch (error) {
		console.error('Load group error:', error)
		showError('Failed to load group: ' + error.message)
	}
}

/**
 * 渲染群组 UI
 */
function renderGroupUI() {
	if (!currentState) return

	// 更新标题
	const titleElement = document.querySelector('.chat-header h2')
	if (titleElement) {
		titleElement.textContent = currentState.groupMeta.name
	}

	// 渲染频道列表
	renderChannelList()
}

/**
 * 渲染频道列表
 */
function renderChannelList() {
	const container = document.getElementById('channels-container')
	if (!container) return

	const channels = Object.values(currentState.channels).filter(c => !c.parentChannelId)

	container.innerHTML = channels.map(channel => {
		const icon = channel.type === 'text' ? '#' : channel.type === 'list' ? '📋' : '🔊'
		const isActive = channel.id === currentChannelId ? 'bg-base-300' : ''

		return `
			<a href="#group:${currentGroupId}:${channel.id}"
			   class="flex items-center gap-2 p-2 rounded-lg hover:bg-base-300 transition-colors ${isActive}"
			   data-channel-id="${channel.id}">
				<span class="text-lg">${icon}</span>
				<div class="flex-1 min-w-0">
					<div class="font-medium truncate">${escapeHtml(channel.name)}</div>
					${channel.desc ? `<div class="text-xs opacity-70 truncate">${escapeHtml(channel.desc)}</div>` : ''}
				</div>
			</a>
		`
	}).join('')
}

/**
 * 加载频道消息
 * @param {string} channelId - 频道ID
 */
async function loadChannelMessages(channelId) {
	try {
		const response = await fetch(
			`/api/parts/shells:chat/${currentGroupId}/channels/${channelId}/messages?limit=50`,
			{ credentials: 'include' }
		)

		if (!response.ok) {
			throw new Error('Failed to load messages')
		}

		const data = await response.json()
		if (!data.success) {
			throw new Error(data.error)
		}

		renderMessages(data.messages)
		lastMessageId = data.messages?.length ? data.messages[data.messages.length - 1].id : null
	} catch (error) {
		console.error('Load messages error:', error)
		showError('Failed to load messages: ' + error.message)
	}
}

/**
 * 渲染消息列表
 * @param {Array} messages - 消息列表
 */
function renderMessages(messages) {
	const container = document.getElementById('chat-messages')
	if (!container) return

	container.innerHTML = messages.map(msg => {
		const time = new Date(msg.timestamp).toLocaleTimeString()
		const sender = msg.sender.substring(0, 8)

		return `
			<div class="chat chat-start" data-message-id="${msg.id}">
				<div class="chat-header">
					${escapeHtml(sender)}
					<time class="text-xs opacity-50">${time}</time>
				</div>
				<div class="chat-bubble">${escapeHtml(msg.content.text || msg.content)}</div>
			</div>
		`
	}).join('')

	// 滚动到底部
	container.scrollTop = container.scrollHeight
}

/**
 * 发送消息
 * @param {string} content - 消息内容
 */
async function sendMessage(content) {
	if (!currentGroupId || !currentChannelId) {
		showError('No channel selected')
		return
	}

	try {
		const response = await fetch(
			`/api/parts/shells:chat/${currentGroupId}/channels/${currentChannelId}/messages`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ content: { text: content } })
			}
		)

		if (!response.ok) {
			throw new Error('Failed to send message')
		}

		const data = await response.json()
		if (!data.success) {
			throw new Error(data.error)
		}

		// 添加消息到界面
		appendMessage(data.event)
		lastMessageId = data.event?.id || lastMessageId

		// 清空输入框
		const input = document.getElementById('message-input')
		if (input) {
			input.value = ''
		}
	} catch (error) {
		console.error('Send message error:', error)
		showError('Failed to send message: ' + error.message)
	}
}

/**
 * 追加消息到界面
 * @param {object} message - 消息对象
 */
function appendMessage(message) {
	const container = document.getElementById('chat-messages')
	if (!container) return

	const time = new Date(message.timestamp).toLocaleTimeString()
	const sender = message.sender.substring(0, 8)

	const messageHtml = `
		<div class="chat chat-start" data-message-id="${message.id}">
			<div class="chat-header">
				${escapeHtml(sender)}
				<time class="text-xs opacity-50">${time}</time>
			</div>
			<div class="chat-bubble">${escapeHtml(message.content.text || message.content)}</div>
		</div>
	`

	container.insertAdjacentHTML('beforeend', messageHtml)
	container.scrollTop = container.scrollHeight
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
	// 发送按钮
	const sendButton = document.getElementById('send-button')
	if (sendButton) {
		sendButton.addEventListener('click', () => {
			const input = document.getElementById('message-input')
			if (input && input.value.trim()) {
				sendMessage(input.value.trim())
			}
		})
	}

	// 输入框回车发送
	const input = document.getElementById('message-input')
	if (input) {
		input.addEventListener('keypress', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault()
				if (input.value.trim()) {
					sendMessage(input.value.trim())
				}
			}
		})
	}

	// 添加频道按钮
	const addChannelBtn = document.getElementById('add-channel-btn')
	if (addChannelBtn) {
		addChannelBtn.addEventListener('click', showCreateChannelModal)
	}
}

/**
 * 显示创建频道模态框
 */
function showCreateChannelModal() {
	// 简化实现：使用 prompt
	const name = prompt('Enter channel name:')
	if (name) {
		createChannel(name)
	}
}

/**
 * 创建频道
 * @param {string} name - 频道名称
 */
async function createChannel(name) {
	try {
		const response = await fetch(`/api/parts/shells:chat/${currentGroupId}/channels`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				type: 'text',
				name,
				desc: ''
			})
		})

		if (!response.ok) {
			throw new Error('Failed to create channel')
		}

		const data = await response.json()
		if (!data.success) {
			throw new Error(data.error)
		}

		// 重新加载群组状态
		await loadGroup(currentGroupId, currentChannelId)
	} catch (error) {
		console.error('Create channel error:', error)
		showError('Failed to create channel: ' + error.message)
	}
}

/**
 * 显示错误消息
 * @param {string} message - 错误消息
 */
function showError(message) {
	console.error(message)
	alert(message)
}

/**
 * 转义 HTML
 * @param {string} text - 文本
 * @returns {string}
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

/**
 * 导出当前群组信息
 */
export function getCurrentGroup() {
	return {
		groupId: currentGroupId,
		channelId: currentChannelId,
		state: currentState
	}
}

function startPolling() {
	if (pollTimer) clearInterval(pollTimer)
	pollTimer = setInterval(() => {
		pollNewMessages().catch(() => 0)
	}, 2000)
}

async function pollNewMessages() {
	if (!currentGroupId || !currentChannelId) return

	const qs = new URLSearchParams()
	if (lastMessageId) qs.set('since', lastMessageId)
	qs.set('limit', '50')

	const res = await fetch(
		`/api/parts/shells:chat/${currentGroupId}/channels/${currentChannelId}/messages?${qs.toString()}`,
		{ credentials: 'include' }
	)
	if (!res.ok) return
	const data = await res.json().catch(() => 0)
	if (!data?.success) return
	const msgs = data.messages || []
	if (!msgs.length) return

	for (const msg of msgs)
		appendMessage(msg)

	lastMessageId = msgs[msgs.length - 1].id || lastMessageId
}
