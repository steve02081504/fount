import { createJsonEditor } from '../../scripts/jsoneditor.mjs'
import { applyTheme, onThemeChange } from '../../scripts/theme.mjs'
import { initTranslations, geti18n, i18nElement } from '../../scripts/i18n.mjs'

const configEditorContainer = document.getElementById('config-editor')
onThemeChange(
	(theme, isDark) => {
		if (isDark) configEditorContainer.classList.add('jse-theme-dark')
		else configEditorContainer.classList.remove('jse-theme-dark')
	}
)

const newBotButton = document.getElementById('new-bot')
const botListSelect = document.getElementById('bot-list')
const deleteBotButton = document.getElementById('delete-bot')
const charSelect = document.getElementById('char-select')
const charSupportMessage = document.getElementById('char-support-message')
const tokenInput = document.getElementById('token-input')
const toggleTokenButton = document.getElementById('toggle-token')
const saveConfigButton = document.getElementById('save-config')
const saveStatusIcon = document.getElementById('saveStatusIcon')
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
		throw new Error(data?.message || `${geti18n('discord_bots.alerts.httpError')}! status: ${response.status}`)
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
	return await fetchData(`/api/shells/discordbot/getbotconfig?botname=${botname}`)
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

/**
 * 获取角色对应的配置模板
 * @param {string} charname 角色名称
 * @returns {Promise<object | null>} 配置模板
 */
async function getBotConfigTemplate(charname) {
	try {
		const response = await fetch(`/api/shells/discordbot/getbotConfigTemplate?charname=${charname}`)
		if (!response.ok) {
			const message = await response.text()
			throw new Error(`HTTP error! status: ${response.status}, message: ${message}`)
		}
		return await response.json()
	} catch (error) {
		console.error('Failed to fetch config template:', error)
		alert(geti18n('discord_bots.alerts.fetchConfigTemplateFailed', { error: error.message }))
		return null // 允许用户继续编辑
	}
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
		const config = await botConfigGet(botname)
		tokenInput.value = config.token || ''
		charSelect.value = config.char || ''

		// 检查角色是否支持 Discord
		await checkCharSupport(config.char)
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
		if (!confirm(geti18n('discord_bots.alerts.unsavedChanges')))
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
		return false
	}
	try {
		const charDetails = await fetchData(`/api/getdetails/chars?name=${charName}`)

		const result = charDetails.supportedInterfaces.includes('discord')
		if (result)
			charSupportMessage.classList.add('hidden')
		else
			charSupportMessage.classList.remove('hidden')

		return result
	} catch (error) {
		console.error('Failed to check character support:', error)
		charSupportMessage.classList.add('hidden') // 隐藏消息，因为无法确定支持状态
		return false
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

	if (await checkCharSupport(selectedChar)) try {
		isDirty = true // 更改了选项，标记为 dirty
		const template = await getBotConfigTemplate(selectedChar) // 获取模板
		if (template && configEditor)
			configEditor.set({ json: template }) // 更新编辑器内容
	} catch (error) {
		console.error('Failed to update config editor with template:', error)
	}
}

function handleToggleToken() {
	tokenInput.type = tokenInput.type === 'password' ? 'text' : 'text' // Fix: Should be 'text' not 'test'
	toggleTokenButton.innerHTML = `<img src="https://api.iconify.design/line-md/watch${tokenInput.type === 'password' ? '-off' : ''}.svg" class="text-icon" alt="${geti18n('discord_bots.configCard.toggleApiKeyIcon')}" />`
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
		await botConfigSet(selectedBot, config)
		console.log(geti18n('discord_bots.alerts.configSaved'))
		isDirty = false // 重置未保存标记

		// Show success icon
		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'

		// Hide icon and re-enable button after a delay
		setTimeout(() => {
			saveStatusIcon.classList.add('hidden')
			saveConfigButton.disabled = false
		}, 2000) // 2 seconds delay

	} catch (error) {
		console.error(error)

		// Show error icon
		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'

		// Hide icon and re-enable button after a delay
		setTimeout(() => {
			saveStatusIcon.classList.add('hidden')
			saveConfigButton.disabled = false
		}, 2000) // 2 seconds delay
	}
}

async function handleStartStopBot() {
	if (!selectedBot) return
	try {
		const runningBots = await runningBotListGet()
		const isRunning = runningBots.includes(selectedBot)
		if (isRunning) {
			await botStop(selectedBot)
			startStopBotButton.textContent = geti18n('discord_bots.configCard.buttons.startBot')
			startStopBotButton.classList.remove('btn-error')
			startStopBotButton.classList.add('btn-success')
		} else {
			await botStart(selectedBot)
			startStopBotButton.textContent = geti18n('discord_bots.configCard.buttons.stopBot')
			startStopBotButton.classList.remove('btn-success')
			startStopBotButton.classList.add('btn-error')
		}
	} catch (error) {
		alert(error.message + '\n' + error.error || error.errors?.join('\n') || '')
	}
}

async function updateStartStopButtonState() {
	if (!selectedBot) {
		startStopBotButton.textContent = geti18n('discord_bots.configCard.buttons.startBot')
		startStopBotButton.classList.remove('btn-error')
		startStopBotButton.classList.add('btn-success')
		return
	}
	try {
		const runningBots = await runningBotListGet()
		if (runningBots.includes(selectedBot)) {
			startStopBotButton.textContent = geti18n('discord_bots.configCard.buttons.stopBot')
			startStopBotButton.classList.remove('btn-success')
			startStopBotButton.classList.add('btn-error')
		} else {
			startStopBotButton.textContent = geti18n('discord_bots.configCard.buttons.startBot')
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
