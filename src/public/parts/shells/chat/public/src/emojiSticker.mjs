/**
 * 表情包和贴纸发送功能
 */

const emojiPicker = null
const stickerPicker = null

/**
 * 初始化表情包功能
 */
export function initEmojiSticker() {
	setupEmojiPicker()
	setupStickerSender()
}

/**
 * 设置表情包选择器
 */
const EMOJI_CATEGORIES = {
	face: { label: '😀 表情', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'] },
	gesture: { label: '👋 手势', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🦷','🦴','👀','👁️','👅','👄','💋','🩸'] },
	heart: { label: '❤️ 心', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','🫶','💏','�','🫂'] },
	animal: { label: '� 动物', emojis: ['🐱','🐶','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','�','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🐢','🐍','🦎','🦂','🦀','🦑','🐙','🐠','🐟','🐡','🐬','🦈','🐳','🐋'] },
	food: { label: '🍔 食物', emojis: ['🍔','🍟','🍕','🌭','🥪','🌮','🌯','🥙','🥚','🍳','🥘','🍲','🥣','🥗','🍿','🧈','🧂','�','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🍵','🫖','🧃','🍶','🍺','🍻','🥂','🍷'] },
	object: { label: '⚽ 物品', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥊','🥋','🎯','⛳','🥅','🏒','🏑','🏏','🪃','🎮','🎲','🧩','🎭','🎨','🎪','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎬','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️'] }
}

/**
 * 绑定表情按钮点击，打开表情选择器。
 * @returns {void}
 */
function setupEmojiPicker() {
	const emojiButton = document.getElementById('emoji-button')
	if (!emojiButton) return

	emojiButton.addEventListener('click', (e) => {
		e.stopPropagation()
		showEmojiPicker()
	})
}

/**
 * 显示表情包选择器（带分类标签页）
 */
function showEmojiPicker() {
	const existing = document.getElementById('emoji-picker-popup')
	if (existing) {
		existing.remove()
		return
	}

	const categories = Object.entries(EMOJI_CATEGORIES)
	const firstKey = categories[0][0]

	const picker = document.createElement('div')
	picker.id = 'emoji-picker-popup'
	picker.className = 'absolute bottom-20 right-4 bg-base-200 rounded-lg shadow-xl p-4 w-80 max-h-96 overflow-y-auto z-50'
	picker.innerHTML = `
		<div class="flex justify-between items-center mb-2">
			<h3 class="font-bold text-lg">选择表情</h3>
			<button id="close-emoji-picker" class="btn btn-ghost btn-sm btn-circle">✕</button>
		</div>
		<div class="tabs tabs-boxed mb-2" id="emoji-category-tabs">
			${categories.map(([key, cat], i) =>
		`<a class="tab tab-sm ${i === 0 ? 'tab-active' : ''}" data-cat="${key}">${cat.label}</a>`
	).join('')}
		</div>
		<div id="emoji-grid-main" class="grid grid-cols-8 gap-1"></div>
	`

	document.body.appendChild(picker)

	/**
	 * 按分类键渲染表情网格 HTML。
	 * @param {string} catKey - 分类键（如 face、gesture）
	 * @returns {void}
	 */
	function renderGrid(catKey) {
		const grid = picker.querySelector('#emoji-grid-main')
		const emojis = EMOJI_CATEGORIES[catKey]?.emojis || []
		grid.innerHTML = emojis.map(e =>
			`<button class="btn btn-ghost btn-sm text-xl hover:scale-125 transition-transform emoji-item" data-emoji="${e}">${e}</button>`
		).join('')
	}

	renderGrid(firstKey)

	picker.querySelector('#close-emoji-picker').addEventListener('click', () => picker.remove())

	picker.querySelector('#emoji-category-tabs').addEventListener('click', (e) => {
		const tab = e.target.closest('[data-cat]')
		if (!tab) return
		picker.querySelectorAll('#emoji-category-tabs .tab').forEach(t => t.classList.remove('tab-active'))
		tab.classList.add('tab-active')
		renderGrid(tab.dataset.cat)
	})

	picker.querySelector('#emoji-grid-main').addEventListener('click', (e) => {
		const btn = e.target.closest('[data-emoji]')
		if (!btn) return
		insertEmoji(btn.dataset.emoji)
		picker.remove()
	})

	setTimeout(() => {
		document.addEventListener('click', function closeOnClickOutside(e) {
			if (!picker.contains(e.target) && e.target.id !== 'emoji-button' && !e.target.closest('#emoji-button')) {
				picker.remove()
				document.removeEventListener('click', closeOnClickOutside)
			}
		})
	}, 0)
}

/**
 * 插入表情到输入框
 * @param {string} emoji - 表情符号
 */
function insertEmoji(emoji) {
	const input = document.getElementById('message-input')
	if (!input) return

	const start = input.selectionStart
	const end = input.selectionEnd
	const text = input.value

	input.value = text.substring(0, start) + emoji + text.substring(end)
	input.selectionStart = input.selectionEnd = start + emoji.length
	input.focus()
}

/**
 * 设置贴纸发送功能
 */
function setupStickerSender() {
	// 贴纸选择器已在之前的代码中实现
}

/**
 * 发送贴纸消息
 * @param {string} stickerId - 贴纸ID
 * @param {string} stickerUrl - 贴纸URL
 */
export async function sendStickerMessage(stickerId, stickerUrl) {
	const groupId = getCurrentGroupId()
	const channelId = getCurrentChannelId()

	if (!groupId || !channelId) {
		console.error('No group or channel selected')
		return
	}

	try {
		const response = await fetch(
			`/api/parts/shells:chat/groups/${groupId}/channels/${channelId}/messages`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					content: {
						type: 'sticker',
						stickerId,
						stickerUrl
					}
				})
			}
		)

		if (!response.ok) 
			throw new Error('Failed to send sticker')
		

		await fetch(`/api/parts/shells:chat/stickers/recent/${stickerId}`, {
			method: 'POST',
			credentials: 'include'
		})
	} catch (error) {
		console.error('Send sticker error:', error)
	}
}

/**
 * 渲染消息中的贴纸
 * @param {object} message - 消息对象
 * @returns {string} 贴纸图片 HTML 或转义后的纯文本内容
 */
export function renderStickerMessage(message) {
	if (message.content.type === 'sticker') 
		return `
			<div class="sticker-message">
				<img src="${escapeHtml(message.content.stickerUrl)}"
					alt="Sticker"
					class="max-w-xs rounded-lg hover:scale-110 transition-transform cursor-pointer"
					onclick="viewSticker('${escapeHtml(message.content.stickerUrl)}')">
			</div>
		`
	
	return escapeHtml(message.content.text || message.content)
}

/**
 * 查看贴纸大图
 * @param {string} url - 贴纸URL
 */
window.viewSticker = function(url) {
	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `
		<div class="modal-box max-w-2xl">
			<img src="${escapeHtml(url)}" alt="Sticker" class="w-full">
			<div class="modal-action">
				<button class="btn" onclick="this.closest('dialog').close()">关闭</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button>close</button></form>
	`
	document.body.appendChild(modal)
	modal.showModal()
}

/**
 * 从 URL hash 解析当前群组 id。
 * @returns {string|null} 群组 id，非群组路由时为 null
 */
function getCurrentGroupId() {
	const hash = window.location.hash.slice(1)
	if (hash.startsWith('group:')) 
		return hash.split(':')[1]
	
	return null
}

/**
 * 从 URL hash 解析当前频道 id。
 * @returns {string|null} 频道 id，非群组路由时为 null
 */
function getCurrentChannelId() {
	const hash = window.location.hash.slice(1)
	if (hash.startsWith('group:')) 
		return hash.split(':')[2]
	
	return null
}

/**
 * HTML 转义，防止 XSS。
 * @param {unknown} text - 任意待显示内容
 * @returns {string} 转义后的字符串
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

/**
 * 在聊天输入区插入表情按钮（若尚未存在）。
 * @returns {void}
 */
export function addEmojiButtonToChat() {
	const inputContainer = document.querySelector('.chat-input')
	if (!inputContainer) return

	if (document.getElementById('emoji-button')) return

	const emojiButton = document.createElement('button')
	emojiButton.id = 'emoji-button'
	emojiButton.className = 'btn btn-ghost btn-circle btn-sm'
	emojiButton.innerHTML = `
		<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
		</svg>
	`

	const sendButton = document.getElementById('send-button')
	if (sendButton && sendButton.parentElement) 
		sendButton.parentElement.insertBefore(emojiButton, sendButton)
	
}
