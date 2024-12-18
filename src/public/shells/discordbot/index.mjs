import { applyTheme } from "../../scripts/theme.mjs"
import { getDiscordBotList, startDiscordBot } from './src/public/endpoints.mjs'

// 获取 bot 列表
async function populateBotList() {
	const botList = await getDiscordBotList()
	const botSelect = document.getElementById('bot-list')
	botList.forEach((bot) => {
		const option = document.createElement('option')
		option.value = bot
		option.text = bot
		botSelect.appendChild(option)
	})
}

// 启动 bot
async function handleStartBot() {
	const selectedBot = document.getElementById('bot-list').value
	try {
		const response = await startDiscordBot(selectedBot)
		console.log(`Bot ${selectedBot} started successfully!`)
		// 这里可以添加一些 UI 提示，例如弹窗或 Toast 提示
	} catch (error) {
		console.error(`Error starting bot ${selectedBot}: ${error.message}`)
		// 这里可以添加一些 UI 提示，例如弹窗或 Toast 提示
	}
}

// 设置事件监听器
function setupEventListeners() {
	document.getElementById('start-bot').addEventListener('click', handleStartBot)
}

// 初始化
function initializeApp() {
	applyTheme()
	populateBotList()
	setupEventListeners()
}

initializeApp()
