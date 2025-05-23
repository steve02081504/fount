import { createJsonEditor } from '../../scripts/jsoneditor.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { initTranslations, geti18n, i18nElement } from '../../scripts/i18n.mjs'
import { getPartList } from '../../scripts/parts.mjs'
import {
	getBotList,
	getBotConfig,
	setBotConfig,
	deleteBotConfig,
	newBotConfig,
	startBot,
	stopBot,
	getRunningBotList,
	getBotConfigTemplate
} from './src/public/endpoints.mjs'

const configEditorContainer = document.getElementById('config-editor')

const newBotButton = document.getElementById('new-bot')
const botListSelect = document.getElementById('bot-list')
const deleteBotButton = document.getElementById('delete-bot')
const charSelect = document.getElementById('char-select')
const tokenInput = document.getElementById('token-input')
const toggleTokenButton = document.getElementById('toggle-token')
const saveConfigButton = document.getElementById('save-config')
const saveStatusIcon = document.getElementById('saveStatusIcon')
const startStopBotButton = document.getElementById('start-stop-bot')
const startStopStatusIcon = document.getElementById('startStopStatusIcon')
const startStopStatusText = document.getElementById('startStopStatusText')

let configEditor = null
let botList = []
let charList = []
let selectedBot = null
let isDirty = false // 标记是否有未保存的更改

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
	charSelect.innerHTML = `<option value="" disabled selected>${geti18n('discord_bots.configCard.charSelectPlaceholder')}</option>`
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
		if (!confirm(geti18n('discord_bots.alerts.unsavedChanges'))) {
			botListSelect.value = selectedBot // 如果取消则还原选择
			return
		}

	selectedBot = botname
	try {
		const config = await getBotConfig(botname) // Updated Call
		tokenInput.value = config.token || ''
		charSelect.value = config.char || ''

		// 加载初始角色模板
		if (config.char && !Object.keys(config.config).length) {
			const template = await getBotConfigTemplate(config.char)
			if (template) config.config = template
		}

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
	const botname = prompt(geti18n('discord_bots.prompts.newBotName'))?.trim()
	if (!botname) return

	if (botList.includes(botname)) {
		alert(geti18n('discord_bots.alerts.botExists', { botname }))
		return
	}

	try {
		await newBotConfig(botname) // Updated Call
		botList = await getBotList() // Updated Call
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
		if (!confirm(geti18n('discord_bots.alerts.unsavedChanges')))
			return

	try {
		await deleteBotConfig(selectedBot) // Updated Call
		botList = await getBotList() // Updated Call
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

async function handleCharSelectChange() {
	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm(geti18n('discord_bots.alerts.unsavedChanges'))) {
			charSelect.value = configEditor.get().json.char || '' // 如果取消则还原选择
			return
		}

	const selectedChar = charSelect.value // 获取选择的角色

	isDirty = true // 更改了选项，标记为 dirty
	const template = await getBotConfigTemplate(selectedChar) // 获取模板
	if (template && configEditor)
		configEditor.set({ json: template }) // 更新编辑器内容
}

function handleToggleToken() {
	tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'
	toggleTokenButton.innerHTML = `<img src="https://api.iconify.design/line-md/watch${tokenInput.type === 'password' ? '-off' : ''}.svg" class="text-icon" data-i18n="discord_bots.configCard.toggleApiKeyIcon" />`
	i18nElement(toggleTokenButton)
}

async function handleSaveConfig() {
	if (!selectedBot) return

	const config = {
		token: tokenInput.value,
		char: charSelect.value,
		config: configEditor.get().json || JSON.parse(configEditor.get().text),
	}

	// Show loading icon and disable button
	saveStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	saveStatusIcon.classList.remove('hidden')
	saveConfigButton.disabled = true

	try {
		await setBotConfig(selectedBot, config) // Updated Call
		console.log(geti18n('discord_bots.alerts.configSaved'))
		isDirty = false // 重置未保存标记

		// Show success icon
		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	} catch (error) {
		alert(error.message + '\n' + error.error || error.errors?.join('\n') || '')
		console.error(error)

		// Show error icon
		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveConfigButton.disabled = false
	}, 2000) // 2 seconds delay
}

async function handleStartStopBot() {
	if (!selectedBot) return

	// Show loading icon and disable button
	startStopStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	startStopStatusIcon.classList.remove('hidden')
	startStopBotButton.disabled = true

	try {
		const runningBots = await getRunningBotList() // Updated Call
		const isRunning = runningBots.includes(selectedBot)
		if (isRunning) {
			await stopBot(selectedBot) // Updated Call
			startStopStatusText.textContent = geti18n('discord_bots.configCard.buttons.startBot')
			startStopBotButton.classList.remove('btn-error')
			startStopBotButton.classList.add('btn-success')
		} else {
			await startBot(selectedBot) // Updated Call
			startStopStatusText.textContent = geti18n('discord_bots.configCard.buttons.stopBot')
			startStopBotButton.classList.remove('btn-success')
			startStopBotButton.classList.add('btn-error')
		}

		startStopStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	} catch (error) {
		alert(error.message + '\n' + error.error || error.errors?.join('\n') || '')
		console.error(error)

		startStopStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	setTimeout(() => {
		startStopStatusIcon.classList.add('hidden')
		startStopBotButton.disabled = false
	}, 2000)
}

async function updateStartStopButtonState() {
	if (!selectedBot) {
		startStopStatusText.textContent = geti18n('discord_bots.configCard.buttons.startBot')
		startStopBotButton.classList.remove('btn-error')
		startStopBotButton.classList.add('btn-success')
		return
	}
	try {
		const runningBots = await getRunningBotList() // Updated Call
		if (runningBots.includes(selectedBot)) {
			startStopStatusText.textContent = geti18n('discord_bots.configCard.buttons.stopBot')
			startStopBotButton.classList.remove('btn-success')
			startStopBotButton.classList.add('btn-error')
		} else {
			startStopStatusText.textContent = geti18n('discord_bots.configCard.buttons.startBot')
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
		botList = await getBotList() // Updated Call
		charList = await getPartList('chars') // Updated Call
		populateBotList()
		populateCharList()

		if (botName) {
			if (!botList.includes(botName))
				// 如果 botName 不存在，则创建新的 bot
				try {
					await newBotConfig(botName) // Updated Call
					botList = await getBotList() // Updated Call
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

		if (charName) 
			charSelect.value = charName
		
	} catch (error) {
		console.error('Failed to initialize from URL parameters:', error)
	}
}

// 初始化
applyTheme()
initTranslations('discord_bots') // Initialize translations with pageid 'discord_bots'
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
		event.returnValue = geti18n('discord_bots.alerts.beforeUnload')
	}
})
