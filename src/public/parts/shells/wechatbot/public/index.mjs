/**
 * WeChat 机器人 shell 的客户端逻辑。
 */
import qrcode from 'https://esm.sh/qrcode-generator'

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
	getBotConfigTemplate,
	startWeixinQrLogin,
	pollWeixinQrLogin
} from './src/endpoints.mjs'

const configEditorContainer = document.getElementById('config-editor')
const apiBaseUrlInput = document.getElementById('api-base-url')
const qrStartButton = document.getElementById('qr-start')
const qrStatusEl = document.getElementById('qr-status')
const qrWrap = document.getElementById('qr-wrap')
const qrContainer = document.getElementById('qr-img')

/**
 * 将二维码内容字符串渲染成图片并注入容器。
 * @param {string} content 要编码的字符串（微信扫码 URL）。
 */
function renderQrCode(content) {
	const qr = qrcode(0, 'M')
	qr.addData(content)
	qr.make()
	qrContainer.innerHTML = qr.createImgTag(5)
	qrWrap.classList.remove('hidden')
}

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

const ICON_LOADING = 'https://api.iconify.design/line-md/loading-loop.svg'
const ICON_SUCCESS = 'https://api.iconify.design/line-md/confirm-circle.svg'
const ICON_ERROR = 'https://api.iconify.design/line-md/emoji-frown.svg'

let configEditor = null
let botList = []
let charList = []
let selectedBot = null
let isDirty = false
/** @type {boolean} Controls the sequential QR poll loop. */
let qrPollActive = false

/**
 * @returns {Promise<void>} 返回值。
 */
async function renderBotDropdown() {
	const disabled = !botList.length
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
		 *
		 * @param {any} selectedItem 下拉框选中项。
 * @returns {Promise<any>} 操作执行结果。
		 */
		onSelect: async (selectedItem) => {
			const botName = selectedItem ? selectedItem.value : null
			if (botName == selectedBot) return
			if (isDirty && !confirmI18n('weixin_bots.alerts.unsavedChanges')) return true
			await loadBotConfig(botName)
		}
	})
}

/**
 * @returns {Promise<void>} 返回值。
 */
async function renderCharDropdown() {
	i18nElement(charSelectDropdown.parentElement)
	const disabled = !charList.length
	const dataList = disabled ? [] : charList.map(name => ({ name, value: name }))

	await createSearchableDropdown({
		dropdownElement: charSelectDropdown,
		dataList,
		textKey: 'name',
		valueKey: 'value',
		disabled,
		/**
		 *
		 * @param {any} selectedItem 下拉框选中项。
 * @returns {any} 操作执行结果。
		 */
		onSelect: (selectedItem) => {
			const charName = selectedItem ? selectedItem.value : null
			if (charName) handleCharSelectChange(charName)
		}
	})
}

/**
 * @param {string} botname 机器人名称。
 * @returns {Promise<void>} 返回值。
 */
async function loadBotConfig(botname) {
	selectedBot = botname

	if (!botname) {
		tokenInput.value = ''
		apiBaseUrlInput.value = ''
		charSelectDropdown.dataset.value = ''
		if (configEditor)
			configEditor.set({ json: {} })
		isDirty = false
		await updateStartStopButtonState()
		return
	}

	try {
		const config = await getBotConfig(botname)
		tokenInput.value = config.token || ''
		apiBaseUrlInput.value = config.apiBaseUrl || ''

		charSelectDropdown.dataset.value = config.char || ''

		if (config.char && !Object.keys(config.config || {}).length) {
			const template = await getBotConfigTemplate(config.char)
			if (template) config.config = template
		}

		if (!configEditor)
			configEditor = createJsonEditor(configEditorContainer, {
				label: geti18n('weixin_bots.configCard.labels.config'),
				/**
				 *
				 * @param {any} updatedContent 编辑器更新后的内容。
				 * @param {any} previousContent 编辑器更新前的内容。
				 * @param {any} root0 解构参数对象。
				 * @param {any} root0.error 错误对象。
 * @returns {any} 返回值。
				 */
				onChange: (updatedContent, previousContent, { error }) => {
					if (!error) isDirty = true
				},
				onSave: handleSaveConfig
			})

		configEditor.set({ json: config.config || {} })
		isDirty = false

		await updateStartStopButtonState()
	}
	catch (error) {
		console.error(error)
	}
}

/**
 * @returns {Promise<void>} 返回值。
 */
async function handleNewBot() {
	const botname = promptI18n('weixin_bots.prompts.newBotName')?.trim()
	if (!botname) return

	if (botList.includes(botname)) {
		showToastI18n('error', 'weixin_bots.alerts.botExists', { botname })
		return
	}

	try {
		await newBotConfig(botname)
		botList = await getBotList()
		await renderBotDropdown()
		botListDropdown.dataset.value = botname
		await loadBotConfig(botname)
		showToastI18n('success', 'weixin_bots.alerts.configSaved')
	}
	catch (error) {
		console.error(error)
		showToast('error', error.message)
	}
}

/**
 * @returns {Promise<void>} 操作执行结果。
 */
async function handleDeleteBot() {
	if (!selectedBot) return

	if (isDirty)
		if (!confirmI18n('weixin_bots.alerts.unsavedChanges'))
			return

	try {
		const oldBotIndex = botList.indexOf(selectedBot)
		await deleteBotConfig(selectedBot)
		botList = await getBotList()

		const nextBotToLoad = botList.length ? botList[Math.min(oldBotIndex, botList.length - 1)] : null
		await loadBotConfig(nextBotToLoad)
		await renderBotDropdown()
	}
	catch (error) {
		console.error(error)
		showToast('error', error.message)
	}
}

/**
 * @param {string} selectedChar 选中的角色名。
 * @returns {Promise<void>} 操作执行结果。
 */
async function handleCharSelectChange(selectedChar) {
	if (isDirty && !confirmI18n('weixin_bots.alerts.unsavedChanges')) return

	if (!selectedChar) {
		charSelectDropdown.dataset.value = ''
		return
	}
	isDirty = true
	const template = await getBotConfigTemplate(selectedChar)
	if (template && configEditor)
		configEditor.set({ json: template })
}

/**
 *
 * @returns {any} 操作执行结果。
 */
function handleToggleToken() {
	tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'
	toggleTokenButton.innerHTML = /* html */ `<img src="https://api.iconify.design/line-md/watch${tokenInput.type === 'password' ? '-off' : ''}.svg" class="text-icon" data-i18n="weixin_bots.configCard.toggleBotTokenIcon" />`
	i18nElement(toggleTokenButton)
}

/**
 * Runs an async button action: shows a loading spinner, then a success/error icon.
 * @param {HTMLButtonElement} button 触发操作的按钮元素。
 * @param {HTMLImageElement} statusIcon 按钮状态图标元素。
 * @param {() => Promise<void>} action 动作名称。
 * @returns {Promise<any>} 操作执行结果。
 */
async function withButtonFeedback(button, statusIcon, action) {
	statusIcon.src = ICON_LOADING
	statusIcon.classList.remove('hidden')
	button.disabled = true

	try {
		await action()
		statusIcon.src = ICON_SUCCESS
	}
	catch (error) {
		const detail = error.error ?? error.errors?.join('\n') ?? ''
		showToast('error', detail ? `${error.message}\n${detail}` : error.message)
		console.error(error)
		statusIcon.src = ICON_ERROR
	}

	setTimeout(() => {
		statusIcon.classList.add('hidden')
		button.disabled = false
	}, 2000)
}

/**
 * @returns {Promise<void>} 返回值。
 */
async function handleSaveConfig() {
	if (!selectedBot) return

	const editorContent = configEditor.get()
	const config = {
		token: tokenInput.value,
		apiBaseUrl: apiBaseUrlInput.value.trim(),
		char: charSelectDropdown.dataset.value,
		config: editorContent.json || JSON.parse(editorContent.text),
	}

	await withButtonFeedback(saveConfigButton, saveStatusIcon, async () => {
		await setBotConfig(selectedBot, config)
		showToastI18n('success', 'weixin_bots.alerts.configSaved')
		isDirty = false
	})
}

/**
 * Updates the start/stop button text and color to reflect the current running state.
 * @param {boolean} isRunning 机器人是否正在运行。
 * @returns {any} 操作执行结果。
 */
function setStartStopButtonUI(isRunning) {
	startStopStatusText.dataset.i18n = isRunning
		? 'weixin_bots.configCard.buttons.stopBot'
		: 'weixin_bots.configCard.buttons.startBot'
	startStopBotButton.classList.toggle('btn-error', isRunning)
	startStopBotButton.classList.toggle('btn-success', !isRunning)
	i18nElement(startStopBotButton)
}

/**
 * @returns {Promise<void>} 返回值。
 */
async function handleStartStopBot() {
	if (!selectedBot) return

	await withButtonFeedback(startStopBotButton, startStopStatusIcon, async () => {
		const runningBots = await getRunningBotList()
		const isRunning = runningBots.includes(selectedBot)
		if (isRunning)
			await stopBot(selectedBot)
		else
			await startBot(selectedBot)
		setStartStopButtonUI(!isRunning)
	})
}

/**
 * @returns {Promise<void>} 操作执行结果。
 */
async function updateStartStopButtonState() {
	try {
		const runningBots = await getRunningBotList()
		setStartStopButtonUI(!!selectedBot && runningBots.includes(selectedBot))
	}
	catch (error) {
		console.error('Failed to update start/stop button state:', error)
	}
}

/**
 * @returns {Promise<void>} 返回值。
 */
async function initializeFromURLParams() {
	const urlParams = new URLSearchParams(window.location.search)
	const botName = urlParams.get('name')
	const charName = urlParams.get('char')

	try {
		botList = await getBotList()
		charList = await getPartList('chars')

		await renderBotDropdown()
		await renderCharDropdown()

		let botToLoad = null
		if (botName && botList.includes(botName))
			botToLoad = botName
		else if (botName && !botList.includes(botName))
			try {
				await newBotConfig(botName)
				botList = await getBotList()
				renderBotDropdown()
				botToLoad = botName
			} catch (error) {
				console.error('Failed to create new bot from URL parameter:', error)
			}
		else if (botList.length)
			botToLoad = botList[0]

		if (botToLoad) {
			botListDropdown.dataset.value = botToLoad
			await loadBotConfig(botToLoad)
		}

		if (charName)
			charSelectDropdown.dataset.value = charName
	}
	catch (error) {
		console.error('Failed to initialize from URL parameters:', error)
	}
}

/**
 *
 * @returns {any} 返回值。
 */
function stopQrPoll() {
	qrPollActive = false
}

/**
 * Handles a single QR poll response, updating the UI accordingly.
 * @param {{ done: boolean, status?: string, connected?: boolean, token?: string, apiBaseUrl?: string, qrcodeUrl?: string, error?: string }} result 轮询结果对象。
 * @returns {Promise<any>} 返回值。
 */
async function handleQrPollResult(result) {
	if (result.status === 'scaned')
		qrStatusEl.textContent = geti18n('weixin_bots.qrLogin.scanned')

	if (result.qrcodeContent)
		renderQrCode(result.qrcodeContent)

	if (result.done && result.connected) {
		if (result.token) tokenInput.value = result.token
		if (result.apiBaseUrl) apiBaseUrlInput.value = String(result.apiBaseUrl).replace(/\/+$/, '')

		if (selectedBot)
			await loadBotConfig(selectedBot)
		else
			isDirty = true

		showToastI18n('success', 'weixin_bots.qrLogin.success')
		qrStatusEl.textContent = geti18n('weixin_bots.qrLogin.success')
	}

	if (result.done && result.error) {
		qrWrap.classList.add('hidden')
		qrStatusEl.textContent = ''
		showToast('error', String(result.error))
	}
}

/**
 * Sequentially polls QR login status until done or stopped.
 * Uses sequential requests to avoid piling up concurrent long-poll calls.
 * @param {string} sessionKey 二维码登录会话键。
 * @returns {Promise<any>} 操作执行结果。
 */
async function startQrPolling(sessionKey) {
	qrPollActive = true
	while (qrPollActive) {
		let result
		try {
			result = await pollWeixinQrLogin(sessionKey)
		}
		catch (error) {
			if (qrPollActive) showToast('error', error.message)
			break
		}
		if (!qrPollActive) break
		await handleQrPollResult(result)
		if (result.done) break
	}
	qrPollActive = false
}

/**
 * @returns {Promise<void>} 返回值。
 */
async function handleQrStart() {
	if (!selectedBot) {
		showToastI18n('error', 'weixin_bots.qrLogin.needBot')
		return
	}
	stopQrPoll()
	qrStatusEl.textContent = geti18n('weixin_bots.qrLogin.waiting')
	qrWrap.classList.add('hidden')
	try {
		const result = await startWeixinQrLogin(selectedBot)
		if (!result.sessionKey)
			throw new Error(result.message || 'no sessionKey')
		renderQrCode(result.qrcodeContent)
		qrStatusEl.textContent = geti18n('weixin_bots.qrLogin.scanPrompt')
		startQrPolling(result.sessionKey)
	}
	catch (error) {
		qrStatusEl.textContent = ''
		showToast('error', error.message)
	}
}

/**
 *
 * @returns {Promise<any>} 操作执行结果。
 */
async function init() {
	applyTheme()
	await initTranslations('weixin_bots')
	initializeFromURLParams()

	newBotButton.addEventListener('click', handleNewBot)
	deleteBotButton.addEventListener('click', handleDeleteBot)
	toggleTokenButton.addEventListener('click', handleToggleToken)
	saveConfigButton.addEventListener('click', handleSaveConfig)
	startStopBotButton.addEventListener('click', handleStartStopBot)
	qrStartButton.addEventListener('click', handleQrStart)

	window.addEventListener('beforeunload', event => {
		stopQrPoll()
		if (isDirty) {
			event.preventDefault()
			event.returnValue = geti18n('weixin_bots.alerts.beforeUnload')
		}
	})
}

init()
