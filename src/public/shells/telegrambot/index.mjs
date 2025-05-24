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
	charSelect.innerHTML = `<option value="" disabled selected>${geti18n('telegram_bots.configCard.charSelectPlaceholder')}</option>`
	charList.forEach(char => {
		const option = document.createElement('option')
		option.value = char
		option.text = char
		charSelect.appendChild(option)
	})
}

async function loadBotConfig(botname) {
	if (isDirty)
		if (!confirm(geti18n('telegram_bots.alerts.unsavedChanges'))) {
			botListSelect.value = selectedBot // 如果取消则还原选择
			return
		}

	selectedBot = botname
	const config = await getBotConfig(botname)
	tokenInput.value = config.token || ''
	charSelect.value = config.char || ''

	// 加载初始角色模板
	if (config.char && (!config.config || Object.keys(config.config).length === 0)) {
		const template = await getBotConfigTemplate(config.char)
		if (template) config.config = template
	}

	if (!configEditor)
		configEditor = createJsonEditor(configEditorContainer, {
			onChange: (updatedContent, previousContent, { error, patchResult }) => {
				if (!error)
					// config.config = updatedContent.json // This will be handled by editor.get() later
					isDirty = true // 标记为有未保存的更改
			},
			onSave: handleSaveConfig
		})

	configEditor.set({ json: config.config || {} })
	isDirty = false // 重置未保存标记

	await updateStartStopButtonState()
}

// 事件处理函数
async function handleNewBot() {
	const botname = prompt(geti18n('telegram_bots.prompts.newBotName'))?.trim()
	if (!botname) return

	if (botList.includes(botname)) {
		alert(geti18n('telegram_bots.alerts.botExists', { botname }))
		return
	}

	await newBotConfig(botname)
	botList = await getBotList()
	populateBotList()
	botListSelect.value = botname
	await loadBotConfig(botname)
}

async function handleDeleteBot() {
	if (!selectedBot) return

	if (isDirty)
		if (!confirm(geti18n('telegram_bots.alerts.unsavedChangesOnDelete')))
			return

	if (!confirm(geti18n('telegram_bots.alerts.confirmDeleteBot', { botname: selectedBot }))) return

	await deleteBotConfig(selectedBot)
	botList = await getBotList()
	populateBotList()

	if (botList.length > 0) {
		botListSelect.selectedIndex = 0
		await loadBotConfig(botList[0])
	} else {
		selectedBot = null
		tokenInput.value = ''
		charSelect.value = ''
		if (configEditor)
			configEditor.set({ json: {} })
	}
	isDirty = false
}


async function handleCharSelectChange() {
	if (isDirty)
		if (!confirm(geti18n('telegram_bots.alerts.unsavedChanges'))) {
			const currentConfig = await getBotConfig(selectedBot)
			charSelect.value = currentConfig.char || '' // 如果取消则还原选择
			return
		}

	const selectedChar = charSelect.value

	isDirty = true // 更改了选项，标记为 dirty
	const template = await getBotConfigTemplate(selectedChar)
	if (template && configEditor)
		configEditor.set({ json: template })
}

function handleToggleToken() {
	tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'
	toggleTokenButton.innerHTML = `<img src="https://api.iconify.design/line-md/watch${tokenInput.type === 'password' ? '-off' : ''}.svg" class="text-icon" data-i18n="telegram_bots.configCard.toggleBotTokenIcon" />`
	i18nElement(toggleTokenButton)
}

async function handleSaveConfig() {
	if (!selectedBot) return

	let editorContent
	try {
		editorContent = configEditor.get() // {json: ..., text: ...}
	} catch (err) {
		alert(geti18n('telegram_bots.alerts.invalidJsonConfig', { error: err.message }))
		return
	}

	const config = {
		token: tokenInput.value,
		char: charSelect.value,
		config: editorContent.json || JSON.parse(editorContent.text || '{}'), // Prioritize json, fallback to parsing text
	}

	saveStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	saveStatusIcon.classList.remove('hidden')
	saveConfigButton.disabled = true

	try {
		await setBotConfig(selectedBot, config)
		console.log(geti18n('telegram_bots.alerts.configSaved'))
		isDirty = false

		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	} catch (error) {
		alert(error.message + '\n' + error.error || error.errors?.join('\n') || '')
		console.error(error)
		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveConfigButton.disabled = false
	}, 2000)
}

async function handleStartStopBot() {
	if (!selectedBot) return

	startStopStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	startStopStatusIcon.classList.remove('hidden')
	startStopBotButton.disabled = true

	try {
		const runningBots = await getRunningBotList()
		const isRunning = runningBots.includes(selectedBot)
		if (isRunning) {
			await stopBot(selectedBot)
			startStopStatusText.textContent = geti18n('telegram_bots.configCard.buttons.startBot')
			startStopBotButton.classList.remove('btn-error')
			startStopBotButton.classList.add('btn-success')
		} else {
			await startBot(selectedBot)
			startStopStatusText.textContent = geti18n('telegram_bots.configCard.buttons.stopBot')
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
		startStopStatusText.textContent = geti18n('telegram_bots.configCard.buttons.startBot')
		startStopBotButton.classList.remove('btn-error')
		startStopBotButton.classList.add('btn-success')
		return
	}
	const runningBots = await getRunningBotList()
	if (runningBots.includes(selectedBot)) {
		startStopStatusText.textContent = geti18n('telegram_bots.configCard.buttons.stopBot')
		startStopBotButton.classList.remove('btn-success')
		startStopBotButton.classList.add('btn-error')
	} else {
		startStopStatusText.textContent = geti18n('telegram_bots.configCard.buttons.startBot')
		startStopBotButton.classList.remove('btn-error')
		startStopBotButton.classList.add('btn-success')
	}
}

function getURLParams() {
	return new URLSearchParams(window.location.search)
}

async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const botName = urlParams.get('name')
	const charName = urlParams.get('char')

	botList = await getBotList()
	charList = await getPartList('chars')
	populateBotList()
	populateCharList()

	if (botName) {
		if (!botList.includes(botName))
			try {
				await newBotConfig(botName)
				botList = await getBotList()
				populateBotList()
			} catch (error) {
				console.error('Failed to create new bot from URL parameter:', error)
			}

		botListSelect.value = botName
		await loadBotConfig(botName)
	} else if (botList.length > 0) {
		botListSelect.selectedIndex = 0
		await loadBotConfig(botList[0])
	}

	if (charName)
		charSelect.value = charName

}

// 初始化
applyTheme()
initTranslations('telegram_bots') // Initialize translations with pageid 'telegram_bots'
initializeFromURLParams()

// 事件监听
newBotButton.addEventListener('click', handleNewBot)
deleteBotButton.addEventListener('click', handleDeleteBot)
botListSelect.addEventListener('change', () => loadBotConfig(botListSelect.value))
charSelect.addEventListener('change', handleCharSelectChange)
toggleTokenButton.addEventListener('click', handleToggleToken)
saveConfigButton.addEventListener('click', handleSaveConfig)
startStopBotButton.addEventListener('click', handleStartStopBot)

window.addEventListener('beforeunload', (event) => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = geti18n('telegram_bots.alerts.beforeUnload')
	}
})
