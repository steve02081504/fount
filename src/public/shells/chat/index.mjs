import { renderTemplate } from "../../scripts/template.mjs"
import { addUserReply, getCharList, getChatLog, triggerCharacterReply, modifyTimeLine } from "./src/public/endpoints.mjs"
import { renderMarkdown } from "../../scripts/markdown.mjs"

// 获取聊天消息容器元素
const chatMessagesContainer = document.getElementById('chat-messages')
// 获取消息输入框元素
const messageInputElement = document.getElementById('message-input')
// 获取发送按钮元素
const sendButtonElement = document.getElementById('send-button')

// 默认头像 URL
const DEFAULT_AVATAR = 'https://gravatar.com/avatar/0?d=mp&f=y'
// 滑动阈值，当水平滑动距离超过此值时触发时间线切换
const SWIPE_THRESHOLD = 50
// 过渡动画持续时间 (毫秒)
const TRANSITION_DURATION = 500

// 应用主题
function applyTheme() {
	document.documentElement.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

// 渲染单条消息
async function renderMessage(message) {
	const renderedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content: renderMarkdown(message.content),
	}
	document.querySelectorAll('.arrow').forEach(arrow => arrow.remove())
	const messageElement = document.createElement('div')
	messageElement.innerHTML = await renderTemplate('message_view', renderedMessage)
	// 如果不是角色消息，移除左右箭头
	if (message.role !== 'char')
		messageElement.querySelectorAll('.arrow').forEach(arrow => arrow.remove())
	else {
		// 为消息元素启用滑动切换功能
		enableSwipe(messageElement)
		// 为箭头添加点击事件监听器
		messageElement.querySelectorAll('.arrow').forEach(arrow => {
			arrow.addEventListener('click', async (event) => {
				const direction = arrow.classList.contains('left') ? -1 : 1
				await replaceLastMessage(await modifyTimeLine(direction))
			})
		})
	}
	return messageElement
}

// 追加消息到聊天窗口
async function appendMessage(message) {
	const messageElement = await renderMessage(message)
	chatMessagesContainer.appendChild(messageElement)
	chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
}

// 替换最后一条消息
async function replaceLastMessage(message) {
	const lastMessageElement = chatMessagesContainer.lastElementChild
	// 如果没有最后一条消息，则直接返回
	if (!lastMessageElement) return

	const newMessageElement = await renderMessage(message)
	// 添加平滑过渡的 CSS 类
	lastMessageElement.classList.add('smooth-transition')
	newMessageElement.classList.add('smooth-transition')
	// 淡出旧消息
	lastMessageElement.style.opacity = '0'

	// 等待过渡动画完成
	await new Promise(resolve => setTimeout(resolve, TRANSITION_DURATION))

	// 用新消息替换旧消息
	lastMessageElement.replaceWith(newMessageElement)
	// 淡入新消息
	newMessageElement.style.opacity = '1'
}

// 启用消息滑动切换功能
function enableSwipe(messageElement) {
	let touchStartX = 0
	// 监听触摸开始事件
	messageElement.addEventListener('touchstart', (event) => {
		touchStartX = event.touches[0].clientX
	}, { passive: true })

	// 监听触摸结束事件
	messageElement.addEventListener('touchend', async (event) => {
		const touchEndX = event.changedTouches[0].clientX
		const deltaX = touchEndX - touchStartX

		// 如果水平滑动距离超过阈值
		if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
			// 确定滑动方向，向左为 1，向右为 -1
			const direction = deltaX > 0 ? -1 : 1
			// 调用 modifyTimeLine API 并替换最后一条消息
			await replaceLastMessage(await modifyTimeLine(direction))
		}
	}, { passive: true })
}

let charList = []

// 发送消息
async function sendMessage() {
	const messageText = messageInputElement.value.trim()
	// 如果消息为空，则直接返回
	if (!messageText) return

	messageInputElement.value = ''
	// 添加用户输入的消息
	await appendMessage(await addUserReply(messageText))
	// 触发角色回复并添加回复消息
	await appendMessage(await triggerCharacterReply(charList[0]))
}

// 发送按钮点击事件
sendButtonElement.addEventListener('click', () => {
	sendMessage()
	messageInputElement.focus()
})

// 消息输入框键盘事件
messageInputElement.addEventListener('keydown', (event) => {
	// 如果按下 Enter 键并且按下了 Shift 或 Ctrl 键
	if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey)) {
		event.preventDefault()
		sendMessage()
	}
})

// 初始化函数
async function init() {
	applyTheme()
	// 获取角色列表
	charList = await getCharList();
	// 获取聊天记录并逐条添加到聊天窗口
	(await getChatLog()).forEach(appendMessage)
	// 聚焦到消息输入框
	messageInputElement.focus()
}

// 执行初始化
init()
