/**
 * Telegram 机器人 shell 的客户端逻辑。
 */
import { initTranslations, geti18n, i18nElement, promptI18n, confirmI18n } from '/scripts/i18n.mjs'
import { createJsonEditor } from '/scripts/jsonEditor.mjs'
import { getPartList } from '/scripts/parts.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { showToast, showToastI18n } from '/scripts/toast.mjs'
import { createSearchableDropdown } from '/scripts/search.mjs'

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
} from './src/endpoints.mjs'

const configEditorContainer = document.getElementById('config-editor')

const newBotButton = document.getElementById('new-bot')
const botListDropdown = document.getElementById('bot-list-dropdown')
const deleteBotButton = document.getElementById('delete-bot')
const charSelectDropdown = document.getElementById('char-select-dropdown')
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

/**
 * 渲染机器人下拉列表。
 * @returns {Promise<void>}
 */
async function renderBotDropdown() {
	const disabled = !botList || !botList.length
	const dataList = disabled ? [] : botList.map(name => ({ name, value: name }))

	if (selectedBot)
		botListDropdown.dataset.value = selectedBot
	else
		delete botListDropdown.dataset.value

	await createSearchableDropdown({
		dropdownElement: botListDropdown,
		dataList,
		textKey: 'name',
		valueKey: 'value',
		disabled,
		/**
		 * @param {object} selectedItem - 选定的项目。
		 * @returns {Promise<void>}
		 */
		onSelect: async (selectedItem) => {
			const botName = selectedItem ? selectedItem.value : null
			if (botName == selectedBot) return
			if (isDirty && !confirmI18n('telegram_bots.alerts.unsavedChanges')) return true
			await loadBotConfig(botName)
		}
	})
}

/**
 * 渲染角色下拉列表。
 * @returns {Promise<void>}
 */
async function renderCharDropdown() {
	i18nElement(charSelectDropdown.parentElement)
	const disabled = !charList || !charList.length
	const dataList = disabled ? [] : charList.map(name => ({ name, value: name }))

	await createSearchableDropdown({
		dropdownElement: charSelectDropdown,
		dataList,
		textKey: 'name',
		valueKey: 'value',
		disabled,
		/**
		 * @param {object} selectedItem - 选定的项目。
		 */
		onSelect: (selectedItem) => {
			const charName = selectedItem ? selectedItem.value : null
			if (charName) handleCharSelectChange(charName)
		}
	})
}

/**
 * 加载机器人配置。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<void>}
 */
async function loadBotConfig(botname) {
	selectedBot = botname

	if (!botname) {
		tokenInput.value = ''
		charSelectDropdown.dataset.value = ''
		if (configEditor)
			configEditor.set({ json: {} })
		isDirty = false
		await updateStartStopButtonState()
		return
	}

	const config = await getBotConfig(botname)
	tokenInput.value = config.token || ''
	charSelectDropdown.dataset.value = config.char || ''

	if (config.char && (!config.config || !Object.keys(config.config).length)) {
		const template = await getBotConfigTemplate(config.char)
		if (template) config.config = template
	}

	if (!configEditor)
		configEditor = createJsonEditor(configEditorContainer, {
			/**
			 * @param {any} updatedContent - 更新后的内容。
			 * @param {any} previousContent - 之前的内容。
			 * @param {object} root0 - 根对象。
			 * @param {any} root0.error - 错误。
			 * @param {any} root0.patchResult - 补丁结果。
			 */
			onChange: (updatedContent, previousContent, { error, patchResult }) => {
				if (!error) isDirty = true
			},
			onSave: handleSaveConfig,
			label: geti18n('telegram_bots.configCard.labels.config')
		})

	configEditor.set({ json: config.config || {} })
	isDirty = false

	await updateStartStopButtonState()
}

/**
 * 处理新建机器人。
 * @returns {Promise<void>}
 */
async function handleNewBot() {
	const botname = promptI18n('telegram_bots.prompts.newBotName')?.trim()
	if (!botname) return

	if (botList.includes(botname)) {
		showToastI18n('error', 'telegram_bots.alerts.botExists', { botname })
		return
	}

	await newBotConfig(botname)
	botList = await getBotList()
	await renderBotDropdown()
	botListDropdown.dataset.value = botname
	await loadBotConfig(botname)
}

/**
 * 处理删除机器人。
 * @returns {Promise<void>}
 */
async function handleDeleteBot() {
	if (!selectedBot) return

	if (!confirmI18n('telegram_bots.alerts.confirmDeleteBot', { botname: selectedBot })) return

	const oldBotIndex = botList.indexOf(selectedBot)
	await deleteBotConfig(selectedBot)
	botList = await getBotList()

	let nextBotToLoad = null
	if (botList.length) {
		const newIndex = Math.min(oldBotIndex, botList.length - 1)
		nextBotToLoad = botList[newIndex]
	}

	await loadBotConfig(nextBotToLoad)
	await renderBotDropdown()
}

/**
 * 处理角色选择更改。
 * @param {string} selectedChar - 选定的角色。
 * @returns {Promise<void>}
 */
async function handleCharSelectChange(selectedChar) {
	if (isDirty)
		if (!confirmI18n('telegram_bots.alerts.unsavedChanges')) {
			const currentConfig = await getBotConfig(selectedBot)
			charSelectDropdown.dataset.value = currentConfig.char || ''
			return
		}

	isDirty = true
	const template = await getBotConfigTemplate(selectedChar)
	if (template && configEditor)
		configEditor.set({ json: template })
}

/**
 * 处理切换令牌可见性。
 */
function handleToggleToken() {
	tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'
	// @fetch-resource https://api.iconify.design/line-md/watch.svg
	// @fetch-resource https://api.iconify.design/line-md/watch-off.svg
	toggleTokenButton.innerHTML = /* html */ `<img src="https://api.iconify.design/line-md/watch${tokenInput.type === 'password' ? '-off' : ''}.svg" class="text-icon" data-i18n="telegram_bots.configCard.toggleBotTokenIcon" />`
	i18nElement(toggleTokenButton)
}

/**
 * 处理保存配置。
 * @returns {Promise<void>}
 */
async function handleSaveConfig() {
	if (!selectedBot) return

	let editorContent
	try {
		editorContent = configEditor.get()
	}
	catch (err) {
		showToastI18n('error', 'telegram_bots.alerts.invalidJsonConfig', { error: err.message })
		return
	}

	const config = {
		token: tokenInput.value,
		char: charSelectDropdown.dataset.value,
		config: editorContent.json || JSON.parse(editorContent.text || '{}'),
	}

	saveStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	saveStatusIcon.classList.remove('hidden')
	saveConfigButton.disabled = true

	try {
		await setBotConfig(selectedBot, config)
		showToastI18n('success', 'telegram_bots.alerts.configSaved')
		isDirty = false

		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	}
	catch (error) {
		showToast('error', error.message + '\n' + error.error || error.errors?.join('\n') || '')
		console.error(error)
		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveConfigButton.disabled = false
	}, 2000)
}

/**
 * 处理启动/停止机器人。
 * @returns {Promise<void>}
 */
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
			startStopStatusText.dataset.i18n = 'telegram_bots.configCard.buttons.startBot'
			startStopBotButton.classList.remove('btn-error')
			startStopBotButton.classList.add('btn-success')
		}
		else {
			await startBot(selectedBot)
			startStopStatusText.dataset.i18n = 'telegram_bots.configCard.buttons.stopBot'
			startStopBotButton.classList.remove('btn-success')
			startStopBotButton.classList.add('btn-error')
		}
		startStopStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	}
	catch (error) {
		showToast('error', error.message + '\n' + error.error || error.errors?.join('\n') || '')
		console.error(error)
		startStopStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	setTimeout(() => {
		startStopStatusIcon.classList.add('hidden')
		startStopBotButton.disabled = false
	}, 2000)
}

/**
 * 更新启动/停止按钮状态。
 * @returns {Promise<void>}
 */
async function updateStartStopButtonState() {
	if (!selectedBot) {
		startStopStatusText.dataset.i18n = 'telegram_bots.configCard.buttons.startBot'
		startStopBotButton.classList.remove('btn-error')
		startStopBotButton.classList.add('btn-success')
		return
	}
	const runningBots = await getRunningBotList()
	if (runningBots.includes(selectedBot)) {
		startStopStatusText.dataset.i18n = 'telegram_bots.configCard.buttons.stopBot'
		startStopBotButton.classList.remove('btn-success')
		startStopBotButton.classList.add('btn-error')
	}
	else {
		startStopStatusText.dataset.i18n = 'telegram_bots.configCard.buttons.startBot'
		startStopBotButton.classList.remove('btn-error')
		startStopBotButton.classList.add('btn-success')
	}
}

/**
 * 获取 URL 参数。
 * @returns {URLSearchParams} - URL 参数。
 */
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

/**
 * 从 URL 参数初始化。
 * @returns {Promise<void>}
 */
async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const botName = urlParams.get('name')
	const charName = urlParams.get('char')

	try {
		// 1. Fetch lists
		botList = await getBotList()
		charList = await getPartList('chars')

		// 2. Render the dropdowns with the lists
		await renderBotDropdown()
		await renderCharDropdown()

		// 3. Determine which bot to load
		let botToLoad = null
		if (botName && botList.includes(botName))
			botToLoad = botName
		else if (botName && !botList.includes(botName))
			// If bot from URL doesn't exist, create it
			try {
				await newBotConfig(botName)
				botList = await getBotList()
				await renderBotDropdown() // re-render with new list
				botToLoad = botName
			} catch (error) {
				console.error('Failed to create new bot from URL parameter:', error)
			}
		else if (botList.length)
			botToLoad = botList[0]

		// 4. Load the bot if one was determined
		if (botToLoad) {
			// Set the dropdown value and load the config
			botListDropdown.dataset.value = botToLoad
			await loadBotConfig(botToLoad)
		}

		// 5. Set the character from URL param, this has precedence
		if (charName)
			charSelectDropdown.dataset.value = charName
	}
	catch (error) {
		console.error('Failed to initialize from URL parameters:', error)
	}
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function init() {
	applyTheme()
	await initTranslations('telegram_bots')
	initializeFromURLParams()

	// 事件监听
	newBotButton.addEventListener('click', handleNewBot)
	deleteBotButton.addEventListener('click', handleDeleteBot)
	toggleTokenButton.addEventListener('click', handleToggleToken)
	saveConfigButton.addEventListener('click', handleSaveConfig)
	startStopBotButton.addEventListener('click', handleStartStopBot)

	window.addEventListener('beforeunload', event => {
		if (isDirty) {
			event.preventDefault()
			event.returnValue = geti18n('telegram_bots.alerts.beforeUnload')
		}
	})
}

init()
