/** 微信机器人 shell 的客户端逻辑。 */
import qrcode from 'https://esm.sh/qrcode-generator'

import { initTranslations, geti18n, i18nElement, promptI18n, confirmI18n } from '/scripts/i18n/index.mjs'
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
	startWechatQrLogin,
	pollWechatQrLogin
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
/**
 * 控制二维码轮询循环是否继续运行。
 * @type {boolean}
 */
let qrPollActive = false

/**
 * 渲染机器人下拉选择框。
 * @returns {Promise<void>}
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
		 * 选中机器人时加载其配置。
		 * @param {any} selectedItem 下拉框选中项。
		 * @returns {Promise<any>} 选中项处理结果。
		 */
		onSelect: async (selectedItem) => {
			const botName = selectedItem ? selectedItem.value : null
			if (botName == selectedBot) return
			if (isDirty && !confirmI18n('wechat_bots.alerts.unsavedChanges')) return true
			await loadBotConfig(botName)
		}
	})
}

/**
 * 渲染角色下拉选择框。
 * @returns {Promise<void>}
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
		 * 选中角色时加载对应配置模板。
		 * @param {any} selectedItem 下拉框选中项。
		 * @returns {any} 无返回值。
		 */
		onSelect: (selectedItem) => {
			const charName = selectedItem ? selectedItem.value : null
			if (charName) handleCharSelectChange(charName)
		}
	})
}

/**
 * 加载指定机器人的配置到编辑器。
 * @param {string} botname 机器人名称。
 * @returns {Promise<void>}
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
				label: geti18n('wechat_bots.configCard.labels.config'),
				/**
				 * 配置编辑器内容变更时标记为未保存。
				 * @param {any} updatedContent 编辑器更新后的内容。
				 * @param {any} previousContent 编辑器更新前的内容。
				 * @param {any} root0 解构参数对象。
				 * @param {any} root0.error 错误对象。
				 * @returns {any} 变更回调返回值。
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
 * 创建新机器人并刷新列表。
 * @returns {Promise<void>}
 */
async function handleNewBot() {
	const botname = promptI18n('wechat_bots.prompts.newBotName')?.trim()
	if (!botname) return

	if (botList.includes(botname)) {
		showToastI18n('error', 'wechat_bots.alerts.botExists', { botname })
		return
	}

	try {
		await newBotConfig(botname)
		botList = await getBotList()
		await renderBotDropdown()
		botListDropdown.dataset.value = botname
		await loadBotConfig(botname)
		showToastI18n('success', 'wechat_bots.alerts.configSaved')
	}
	catch (error) {
		console.error(error)
		showToast('error', error.message)
	}
}

/**
 * 删除当前选中的机器人配置。
 * @returns {Promise<void>}
 */
async function handleDeleteBot() {
	if (!selectedBot) return

	if (isDirty)
		if (!confirmI18n('wechat_bots.alerts.unsavedChanges'))
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
 * 角色选择变更时加载对应配置模板。
 * @param {string} selectedChar 选中的角色名。
 * @returns {Promise<void>}
 */
async function handleCharSelectChange(selectedChar) {
	if (isDirty && !confirmI18n('wechat_bots.alerts.unsavedChanges')) return

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
 * 切换 Token 输入框的显示/隐藏。
 * @returns {any} 无返回值。
 */
function handleToggleToken() {
	tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'
	toggleTokenButton.innerHTML = /* html */ `<img src="https://api.iconify.design/line-md/watch${tokenInput.type === 'password' ? '-off' : ''}.svg" class="text-icon" data-i18n="wechat_bots.configCard.toggleBotTokenIcon" />`
	i18nElement(toggleTokenButton)
}

/**
 * 执行异步按钮操作并显示加载/成功/失败图标反馈。
 * @param {HTMLButtonElement} button 触发操作的按钮元素。
 * @param {HTMLImageElement} statusIcon 按钮状态图标元素。
 * @param {() => Promise<void>} action 要执行的异步操作。
 * @returns {Promise<any>} 操作完成后的 Promise。
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
 * 保存当前机器人的配置。
 * @returns {Promise<void>}
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
		showToastI18n('success', 'wechat_bots.alerts.configSaved')
		isDirty = false
	})
}

/**
 * 根据运行状态更新启动/停止按钮的文案与样式。
 * @param {boolean} isRunning 机器人是否正在运行。
 * @returns {any} 无返回值。
 */
function setStartStopButtonUI(isRunning) {
	startStopStatusText.dataset.i18n = isRunning
		? 'wechat_bots.configCard.buttons.stopBot'
		: 'wechat_bots.configCard.buttons.startBot'
	startStopBotButton.classList.toggle('btn-error', isRunning)
	startStopBotButton.classList.toggle('btn-success', !isRunning)
	i18nElement(startStopBotButton)
}

/**
 * 启动或停止当前选中的机器人。
 * @returns {Promise<void>}
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
 * 查询运行状态并同步启动/停止按钮 UI。
 * @returns {Promise<void>}
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
 * 从 URL 参数初始化机器人与角色选择。
 * @returns {Promise<void>}
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
 * 停止二维码登录轮询循环。
 * @returns {any} 无返回值。
 */
function stopQrPoll() {
	qrPollActive = false
}

/**
 * 处理单次二维码轮询响应并更新界面。
 * @param {{ done: boolean, status?: string, connected?: boolean, token?: string, apiBaseUrl?: string, qrcodeUrl?: string, error?: string }} result 轮询结果对象。
 * @returns {Promise<any>} 操作完成后的 Promise。
 */
async function handleQrPollResult(result) {
	if (result.status === 'scanned')
		qrStatusEl.textContent = geti18n('wechat_bots.qrLogin.scanned')

	if (result.qrcodeContent)
		renderQrCode(result.qrcodeContent)

	if (result.done && result.connected) {
		if (result.token) tokenInput.value = result.token
		if (result.apiBaseUrl) apiBaseUrlInput.value = String(result.apiBaseUrl).replace(/\/+$/, '')

		if (selectedBot)
			await loadBotConfig(selectedBot)
		else
			isDirty = true

		showToastI18n('success', 'wechat_bots.qrLogin.success')
		qrStatusEl.textContent = geti18n('wechat_bots.qrLogin.success')
	}

	if (result.done && result.error) {
		qrWrap.classList.add('hidden')
		qrStatusEl.textContent = ''
		showToast('error', String(result.error))
	}
}

/**
 * 顺序轮询二维码登录状态，直到完成或停止。
 * 使用串行请求避免堆积并发长轮询。
 * @param {string} sessionKey 二维码登录会话键。
 * @returns {Promise<any>} 操作完成后的 Promise。
 */
async function startQrPolling(sessionKey) {
	qrPollActive = true
	while (qrPollActive) {
		let result
		try {
			result = await pollWechatQrLogin(sessionKey)
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
 * 发起微信二维码登录并启动轮询。
 * @returns {Promise<void>}
 */
async function handleQrStart() {
	if (!selectedBot) {
		showToastI18n('error', 'wechat_bots.qrLogin.needBot')
		return
	}
	stopQrPoll()
	qrStatusEl.textContent = geti18n('wechat_bots.qrLogin.waiting')
	qrWrap.classList.add('hidden')
	try {
		const result = await startWechatQrLogin(selectedBot)
		if (!result.sessionKey)
			throw new Error(result.message || 'no sessionKey')
		renderQrCode(result.qrcodeContent)
		qrStatusEl.textContent = geti18n('wechat_bots.qrLogin.scanPrompt')
		startQrPolling(result.sessionKey)
	}
	catch (error) {
		qrStatusEl.textContent = ''
		showToast('error', error.message)
	}
}

/**
 * 初始化页面：应用主题、翻译并绑定事件。
 * @returns {Promise<any>} 操作完成后的 Promise。
 */
async function init() {
	applyTheme()
	await initTranslations('wechat_bots')
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
			event.returnValue = geti18n('wechat_bots.alerts.beforeUnload')
		}
	})
}

init()
