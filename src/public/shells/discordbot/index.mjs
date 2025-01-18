import { createJSONEditor } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/standalone.js'
import { applyTheme } from '../../scripts/theme.mjs'

const configEditorContainer = document.getElementById('config-editor')
if (applyTheme()) configEditorContainer.classList.add('jse-theme-dark')

const newBotButton = document.getElementById('new-bot')
const botListSelect = document.getElementById('bot-list')
const deleteBotButton = document.getElementById('delete-bot')
const charSelect = document.getElementById('char-select')
const charSupportMessage = document.getElementById('char-support-message')
const tokenInput = document.getElementById('token-input')
const toggleTokenButton = document.getElementById('toggle-token')
const saveConfigButton = document.getElementById('save-config')
const startBotButton = document.getElementById('start-bot')

let configEditor = null
let botList = []
let charList = []
let selectedBot = null

// 抽象的 API 请求函数 (使用前面定义的 fetchData 函数)
async function fetchData(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || `HTTP error! status: ${response.status}`)
	}
	return await response.json()
}

// API 请求函数 (现在使用 fetchData)
async function botListGet() {
	return await fetchData('/api/shells/discordbot/getbotlist')
}

async function charListGet() {
	return await fetchData('/api/getlist/chars')
}

async function botConfigGet(botname) {
	return await fetchData('/api/shells/discordbot/getbotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

async function botConfigSet(botname, config) {
	await fetchData('/api/shells/discordbot/setbotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname, config }),
	})
}

async function botConfigDelete(botname) {
	await fetchData('/api/shells/discordbot/deletebotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

async function botConfigNew(botname) {
	await fetchData('/api/shells/discordbot/newbotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

async function botStart(botname) {
	await fetchData('/api/shells/discordbot/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

// UI 更新函数
function populateBotList() {
	botListSelect.innerHTML = ''
	botList.forEach(bot => {
		const option = document.createElement('option')
		option.value = bot
		option.text = bot
		botListSelect.appendChild(option)
	})
}

function populateCharList() {
	charSelect.innerHTML = '<option value="" disabled selected>Select Character</option>'
	charList.forEach(char => {
		const option = document.createElement('option')
		option.value = char
		option.text = char
		charSelect.appendChild(option)
	})
}

async function loadBotConfig(botname) {
	selectedBot = botname
	try {
		const config = await botConfigGet(botname)
		tokenInput.value = config.token || ''
		charSelect.value = config.char || ''

		// 检查角色是否支持 Discord
		await checkCharSupport(config.char)

		if (!configEditor)
			configEditor = createJSONEditor({
				target: configEditorContainer,
				props: {
					mode: 'code',
					indentation: '\t',
					onChange: (updatedContent, previousContent, { error, patchResult }) => {
						if (!error)
							config.config = updatedContent.json

					}
				}
			})


		configEditor.set({ json: config.config || {} })
	} catch (error) {
		console.error(error)
	}
}

// 事件处理函数
async function handleNewBot() {
	const botname = prompt('请输入新的 Bot 名称：')?.trim()
	if (!botname) return

	if (botList.includes(botname)) {
		alert(`名为 "${botname}" 的 Bot 已存在，请使用其他名称。`)
		return
	}

	try {
		await botConfigNew(botname)
		botList = await botListGet()
		populateBotList()
		botListSelect.value = botname
		await loadBotConfig(botname)
	} catch (error) {
		console.error(error)
	}
}

async function handleDeleteBot() {
	if (!selectedBot) return

	try {
		await botConfigDelete(selectedBot)
		botList = await botListGet()
		populateBotList()
		selectedBot = null
		tokenInput.value = ''
		charSelect.value = ''
		configEditor.set({ json: {} })
	} catch (error) {
		console.error(error)
	}
}

async function checkCharSupport(charName) {
	if (!charName) {
		charSupportMessage.classList.add('hidden')
		return
	}
	try {
		const charDetails = await fetchData(`/api/getdetails/chars?name=${charName}`)
		if (!charDetails.supportedInterfaces.includes('discord'))
			charSupportMessage.classList.remove('hidden')
		else
			charSupportMessage.classList.add('hidden')

	} catch (error) {
		console.error('Failed to check character support:', error)
		charSupportMessage.classList.add('hidden') // 隐藏消息，因为无法确定支持状态
	}
}

async function handleCharSelectChange() {
	await checkCharSupport(charSelect.value)
}

function handleToggleToken() {
	tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'
	toggleTokenButton.innerHTML = `<img src="https://api.iconify.design/line-md/watch${tokenInput.type === 'password' ? '-off' : ''}.svg" class="dark:invert" />`
}

async function handleSaveConfig() {
	if (!selectedBot) return

	const config = {
		token: tokenInput.value,
		char: charSelect.value,
		config: configEditor.get().json,
	}

	try {
		await botConfigSet(selectedBot, config)
		console.log('Config saved successfully')
	} catch (error) {
		console.error(error)
	}
}

async function handleStartBot() {
	if (!selectedBot) return
	try {
		await botStart(selectedBot)
	} catch (error) {
		alert(error.message)
	}
}

/**
 * 解析 URL 参数
 * @returns {URLSearchParams} URL 参数对象
 */
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

/**
 * 根据 URL 参数进行初始化
 */
async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const botName = urlParams.get('name') // 使用 'name' 参数
	const charName = urlParams.get('char') // 使用 'char' 参数

	try {
		botList = await botListGet()
		charList = await charListGet()
		populateBotList()
		populateCharList()

		if (botName) {
			if (!botList.includes(botName))
				// 如果 botName 不存在，则创建新的 bot
				try {
					await botConfigNew(botName)
					botList = await botListGet()
					populateBotList()
				} catch (error) {
					console.error('Failed to create new bot from URL parameter:', error)
				}

			botListSelect.value = botName
			await loadBotConfig(botName)
		} else if (botList.length > 0) {
			// 如果没有提供 botName 且 botList 不为空，则加载第一个 Bot 的配置
			botListSelect.selectedIndex = 0 // 确保选中第一个选项
			await loadBotConfig(botList[0]) // 手动加载第一个 Bot 的配置
		}

		if (charName) {
			charSelect.value = charName
			await checkCharSupport(charName)
		}
	} catch (error) {
		console.error('Failed to initialize from URL parameters:', error)
	}
}

// 初始化
initializeFromURLParams()

// 事件监听
newBotButton.addEventListener('click', handleNewBot)
deleteBotButton.addEventListener('click', handleDeleteBot)
botListSelect.addEventListener('change', () => loadBotConfig(botListSelect.value))
charSelect.addEventListener('change', handleCharSelectChange)
toggleTokenButton.addEventListener('click', handleToggleToken)
saveConfigButton.addEventListener('click', handleSaveConfig)
startBotButton.addEventListener('click', handleStartBot)
