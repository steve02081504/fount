import { getPartList } from '../../../../../scripts/parts.mjs'
import { showToast } from '../../../../../scripts/toast.mjs'
import { charList, groupSettings, setGroupSettingsState } from '../chat.mjs'
import { setGroupSettings as persistGroupSettings } from '../endpoints.mjs'

const titleInput = document.getElementById('group-title-input')
const descriptionInput = document.getElementById('group-description-input')
const saveButton = document.getElementById('group-settings-save')
const resetButton = document.getElementById('group-settings-reset')
const statusElement = document.getElementById('group-settings-status')
const memberCountElement = document.getElementById('group-member-count')
const modeElement = document.getElementById('group-mode-badge')
const chatTitleElement = document.getElementById('chat-title')
const chatSubtitleElement = document.getElementById('chat-subtitle')
const allowedPersonasContainer = document.getElementById('allowed-personas-container')
const allowedPersonasSelect = document.getElementById('allowed-personas-select')
const allowedPersonasAdd = document.getElementById('allowed-personas-add')

let isInitialized = false
let isSaving = false
let hasUnsavedChanges = false
let draftAllowedPersonas = []

/**
 * 裁剪并规范化群设置字段，供表单与保存使用。
 * @param {object} [settings] - 原始设置对象（可部分缺失）
 * @returns {{ title: string, description: string, allowedPersonas: string[] }} 规范化后的设置快照
 */
function normalizeGroupSettings(settings) {
	return {
		title: typeof settings?.title === 'string' ? settings.title.trim().slice(0, 80) : '',
		description: typeof settings?.description === 'string' ? settings.description.trim().slice(0, 300) : '',
		allowedPersonas: Array.isArray(settings?.allowedPersonas) ? [...settings.allowedPersonas] : [],
	}
}

/**
 * 从当前表单控件读取草稿设置。
 * @returns {{ title: string, description: string, allowedPersonas: string[] }} 与 `normalizeGroupSettings` 同形的草稿
 */
function getDraftSettings() {
	return normalizeGroupSettings({
		title: titleInput?.value,
		description: descriptionInput?.value,
		allowedPersonas: [...draftAllowedPersonas],
	})
}

/**
 * 当未填写群标题时的占位标题（由角色列表拼接）。
 * @returns {string} 展示用标题
 */
function getFallbackTitle() {
	if (charList.length) return charList.join(', ')
	return '未命名群聊'
}

/**
 * 根据当前角色数量返回模式徽标文案。
 * @returns {string} 群聊 / 单角色 / 空群组
 */
function getChatModeLabel() {
	if (charList.length > 1) return '群聊'
	if (charList.length === 1) return '单角色'
	return '空群组'
}

/**
 * 更新设置面板底部状态行样式与文案。
 * @param {string} text - 状态文本
 * @param {'muted'|'error'|'success'} [tone='muted'] - 语义色调
 * @returns {void}
 */
function updateStatus(text, tone = 'muted') {
	if (!statusElement) return
	statusElement.textContent = text
	statusElement.classList.remove('text-error', 'text-success', 'opacity-70')

	if (tone === 'error') {
		statusElement.classList.add('text-error')
		return
	}

	if (tone === 'success') {
		statusElement.classList.add('text-success')
		return
	}

	statusElement.classList.add('opacity-70')
}

/**
 * 将群标题/副标题写入顶栏 DOM。
 * @param {{ title?: string, description?: string, allowedPersonas?: string[] }} [settings] - 展示用设置；默认取全局 `groupSettings` 规范化结果
 * @returns {void}
 */
function updateHeader(settings = normalizeGroupSettings(groupSettings)) {
	if (!chatTitleElement) return

	chatTitleElement.textContent = settings.title || getFallbackTitle()

	if (!chatSubtitleElement) return

	chatSubtitleElement.textContent = settings.description || `${charList.length} 个角色在此聊天中`
}

/**
 *
 */
export function refreshChatSettingsMeta() {
	if (memberCountElement)
		memberCountElement.textContent = String(charList.length)

	if (modeElement)
		modeElement.textContent = getChatModeLabel()

	updateHeader(hasUnsavedChanges ? getDraftSettings() : normalizeGroupSettings(groupSettings))
}

/**
 *
 */
function renderAllowedPersonas() {
	if (!allowedPersonasContainer) return
	allowedPersonasContainer.innerHTML = ''
	for (const persona of draftAllowedPersonas) {
		const badge = document.createElement('span')
		badge.className = 'badge badge-primary gap-1'
		badge.textContent = persona
		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.textContent = '×'
		removeBtn.className = 'cursor-pointer font-bold leading-none'
		removeBtn.addEventListener('click', () => {
			draftAllowedPersonas = draftAllowedPersonas.filter(p => p !== persona)
			renderAllowedPersonas()
			markDirty()
		})
		badge.appendChild(removeBtn)
		allowedPersonasContainer.appendChild(badge)
	}

	// Hide already-added options from select
	if (allowedPersonasSelect)
		for (const option of allowedPersonasSelect.options)
			option.hidden = draftAllowedPersonas.includes(option.value)
}

/**
 *
 */
async function populatePersonasSelect() {
	if (!allowedPersonasSelect) return
	try {
		const personas = await getPartList('personas')
		for (const option of Array.from(allowedPersonasSelect.options))
			if (option.value) allowedPersonasSelect.removeChild(option)
		for (const p of personas) {
			const opt = document.createElement('option')
			opt.value = p
			opt.text = p
			allowedPersonasSelect.appendChild(opt)
		}
	} catch (e) {
		console.error('Failed to load personas:', e)
	}
}

/**
 * 用服务端或全局状态刷新群设置表单与元信息。
 * @param {object} [settings=groupSettings] - 新的群设置对象
 * @returns {void}
 */
export function updateChatSettingsPanel(settings = groupSettings) {
	setGroupSettingsState(settings)
	const normalized = normalizeGroupSettings(groupSettings)

	if (titleInput) titleInput.value = normalized.title
	if (descriptionInput) descriptionInput.value = normalized.description

	draftAllowedPersonas = [...normalized.allowedPersonas]
	renderAllowedPersonas()

	hasUnsavedChanges = false
	if (!isSaving) updateStatus('已保存', 'success')
	refreshChatSettingsMeta()
}

/**
 *
 */
async function saveChatSettings() {
	if (isSaving || !titleInput || !descriptionInput || !saveButton || !resetButton) return

	isSaving = true
	let saveSucceeded = false
	saveButton.disabled = true
	resetButton.disabled = true
	updateStatus('正在保存...', 'muted')

	try {
		const response = await persistGroupSettings(getDraftSettings())
		const nextSettings = normalizeGroupSettings(response?.groupSettings ?? response)
		setGroupSettingsState(nextSettings)
		updateChatSettingsPanel(nextSettings)
		saveSucceeded = true
		showToast('success', '群聊设置已保存')
	}
	catch (error) {
		updateStatus('保存失败', 'error')
		showToast('error', error?.message || '无法保存群聊设置')
	}
	finally {
		isSaving = false
		saveButton.disabled = false
		resetButton.disabled = false
		if (saveSucceeded) updateStatus('Saved', 'success')
	}
}

/**
 *
 */
function markDirty() {
	hasUnsavedChanges = true
	updateStatus('有未保存的更改', 'muted')
	refreshChatSettingsMeta()
}

/**
 * 外部通知：群设置已在别处更新，同步到本面板。
 * @param {object} settings - 最新群设置
 * @returns {void}
 */
export function handleGroupSettingsUpdated(settings) {
	updateChatSettingsPanel(settings)
}

/**
 * 绑定群设置表单控件与保存/重置逻辑（幂等，仅初始化一次）。
 * @returns {void}
 */
export function setupChatSettings() {
	if (isInitialized || !titleInput || !descriptionInput || !saveButton || !resetButton) return
	isInitialized = true

	titleInput.addEventListener('input', markDirty)
	descriptionInput.addEventListener('input', markDirty)

	titleInput.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			saveChatSettings()
		}
	})

	descriptionInput.addEventListener('keydown', event => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault()
			saveChatSettings()
		}
	})

	saveButton.addEventListener('click', saveChatSettings)
	resetButton.addEventListener('click', () => {
		updateChatSettingsPanel(groupSettings)
	})

	if (allowedPersonasAdd && allowedPersonasSelect) 
		allowedPersonasAdd.addEventListener('click', () => {
			const val = allowedPersonasSelect.value
			if (val && !draftAllowedPersonas.includes(val)) {
				draftAllowedPersonas = [...draftAllowedPersonas, val]
				renderAllowedPersonas()
				allowedPersonasSelect.value = ''
				markDirty()
			}
		})
	

	populatePersonasSelect()
	refreshChatSettingsMeta()
	updateStatus('Saved', 'success')
}
