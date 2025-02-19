import { createJsonEditor } from '../../scripts/jsoneditor.mjs'
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
const startStopBotButton = document.getElementById('start-stop-bot')

let configEditor = null
let botList = []
let charList = []
let selectedBot = null
let isDirty = false // 标记是否有未保存的更改

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

async function botStop(botname) {
	await fetchData('/api/shells/discordbot/stop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

async function runningBotListGet() {
	return await fetchData('/api/shells/discordbot/getrunningbotlist')
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
	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?')) {
			botListSelect.value = selectedBot // 如果取消则还原选择
			return
		}

	selectedBot = botname
	try {
		const config = await botConfigGet(botname)
		tokenInput.value = config.token || ''
		charSelect.value = config.char || ''

		// 检查角色是否支持 Discord
		await checkCharSupport(config.char)

		if (!configEditor)
			configEditor = createJsonEditor(configEditorContainer, {
				onChange: (updatedContent, previousContent, { error, patchResult }) => {
					if (!error) {
						config.config = updatedContent.json
						isDirty = true // 标记为有未保存的更改
					}
				},
				onSave: handleSaveConfig
			})

		configEditor.set({ json: config.config || {} })
		isDirty = false // 重置未保存标记

		await updateStartStopButtonState()
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

	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?'))
			return

	try {
		await botConfigDelete(selectedBot)
		botList = await botListGet()
		populateBotList()

		// 如果删除的是当前选中的 bot，则 selectedBot 设为 null，否则保持不变
		if (selectedBot === botListSelect.value) {
			selectedBot = null
			tokenInput.value = ''
			charSelect.value = ''
			if (configEditor)
				configEditor.set({ json: {} })
		} else
			// 如果删除的不是当前选中的 bot，则重新加载当前选中的 bot 的配置
			await loadBotConfig(botListSelect.value)

		// 无论如何，都要更新 isDirty 状态
		isDirty = false
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
	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?')) {
			charSelect.value = configEditor.get().json.char || '' // 如果取消则还原选择
			return
		}

	await checkCharSupport(charSelect.value)
	isDirty = true // 更改了选项，标记为 dirty
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
		config: configEditor.get().json || JSON.parse(configEditor.get().text),
	}

	try {
		await botConfigSet(selectedBot, config)
		console.log('Config saved successfully')
		isDirty = false // 重置未保存标记
	} catch (error) {
		console.error(error)
	}
}

async function handleStartStopBot() {
	if (!selectedBot) return
	try {
		const runningBots = await runningBotListGet()
		const isRunning = runningBots.includes(selectedBot)
		if (isRunning) {
			await botStop(selectedBot)
			startStopBotButton.textContent = '启动'
			startStopBotButton.classList.remove('btn-error')
			startStopBotButton.classList.add('btn-success')
		} else {
			await botStart(selectedBot)
			startStopBotButton.textContent = '停止'
			startStopBotButton.classList.remove('btn-success')
			startStopBotButton.classList.add('btn-error')
		}
	} catch (error) {
		alert(error.message)
	}
}

async function updateStartStopButtonState() {
	if (!selectedBot) {
		startStopBotButton.textContent = '启动'
		startStopBotButton.classList.remove('btn-error')
		startStopBotButton.classList.add('btn-success')
		return
	}
	try {
		const runningBots = await runningBotListGet()
		if (runningBots.includes(selectedBot)) {
			startStopBotButton.textContent = '停止'
			startStopBotButton.classList.remove('btn-success')
			startStopBotButton.classList.add('btn-error')
		} else {
			startStopBotButton.textContent = '启动'
			startStopBotButton.classList.remove('btn-error')
			startStopBotButton.classList.add('btn-success')
		}
	} catch (error) {
		console.error('Failed to update start/stop button state:', error)
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
startStopBotButton.addEventListener('click', handleStartStopBot)

// 离开页面时提醒
window.addEventListener('beforeunload', (event) => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
	}
})
