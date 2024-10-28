import { getDiscordBotList, startDiscordBot } from './src/public/endpoints.mjs'

// 获取 bot 列表
getDiscordBotList().then((botList) => {
	const botSelect = document.getElementById('bot-list')
	botList.forEach((bot) => {
		const option = document.createElement('option')
		option.value = bot
		option.text = bot
		botSelect.appendChild(option)
	})
})

// 点击运行按钮
document.getElementById('start-bot').addEventListener('click', () => {
	const selectedBot = document.getElementById('bot-list').value
	startDiscordBot(selectedBot).then((response) => {
		console.log(`Bot ${selectedBot} started successfully!`)
	}).catch((error) => {
		console.error(`Error starting bot ${selectedBot}: ${error.message}`)
	})
})
