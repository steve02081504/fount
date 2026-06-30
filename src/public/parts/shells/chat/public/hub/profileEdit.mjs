/**
 * 【文件】public/hub/profileEdit.mjs
 * 【职责】Hub 内资料编辑模态：头像上传、昵称/简介/标签表单与 `updateEntityProfileApi` 提交。
 * 【原理】`openHubProfileEdit` 弹出编辑对话框并绑定保存/取消；成功后刷新顶栏与成员展示。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/i18n、../../../../scripts/template、../../../../scripts/toast、../profile/src/endpoints、../src/entityProfileApi、../src/profileLocaleEditor、core/state、presence。
 */
import { renderTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { uploadAvatar } from '../profile/src/endpoints.mjs'
import { updateEntityProfileApi } from '../src/entityProfileApi.mjs'
import {
	ensureLocaleEntry,
	formatLinksInput,
	formatTagsInput,
	parseLinksInput,
	parseTagsInput,
	promptNewLocaleKey,
	renderLocaleTabs,
} from '../src/profileLocaleEditor.mjs'

import { hubStore } from './core/state.mjs'
import { invalidateUserProfileCache } from './presence.mjs'

/** @type {HTMLDialogElement | null} */
let editDialog = null
/** @type {string | null} */
let editingEntityHash = null
/** @type {object | null} */
let editingBaseProfile = null
/** @type {Record<string, object>} */
let editingLocalized = {}
/** @type {string} */
let activeLocaleKey = ''
/** @type {object | null} */
let editingInfoDefaults = null
/** @type {(() => void | Promise<void>) | null} */
let onSavedCallback = null

/**
 * 确保资料编辑对话框已挂载。
 * @returns {Promise<HTMLDialogElement>} 编辑对话框元素
 */
async function ensureEditDialog() {
	if (editDialog?.isConnected) return editDialog
	usingTemplates('/parts/shells:chat/src/templates')
	const node = await renderTemplate('hub/profile_edit_modal', {})
	editDialog = node instanceof HTMLDialogElement && node.id === 'hub-profile-edit-modal'
		? node
		: node.querySelector('#hub-profile-edit-modal')
	if (!(editDialog instanceof HTMLDialogElement))
		throw new Error('hub profile edit modal missing')
	document.body.appendChild(node)

	editDialog.querySelector('#hub-profile-edit-cancel')?.addEventListener('click', () => editDialog?.close())
	editDialog.querySelector('#hub-profile-edit-save')?.addEventListener('click', () => { void handleSaveProfile() })
	editDialog.querySelector('#hub-profile-edit-avatar-upload')?.addEventListener('change', (event) => {
		const file = event.target?.files?.[0]
		if (!file) return
		const reader = new FileReader()
		/** @param {ProgressEvent<FileReader>} loadEvent 读取完成 */
		reader.onload = (loadEvent) => {
			const preview = editDialog?.querySelector('#hub-profile-edit-avatar-preview')
			if (preview instanceof HTMLImageElement && loadEvent.target?.result)
				preview.src = String(loadEvent.target.result)
		}
		reader.readAsDataURL(file)
	})
	return editDialog
}

/** @returns {void} */
function persistActiveLocaleForm() {
	if (!activeLocaleKey) return
	const md = editDialog?.querySelector('#hub-profile-edit-description-markdown')?.value ?? ''
	editingLocalized[activeLocaleKey] = {
		name: editDialog?.querySelector('#hub-profile-edit-name')?.value?.trim() || '',
		description_markdown: md,
		description: md.replace(/[#*[\]_`]/g, '').trim(),
		tags: parseTagsInput(editDialog?.querySelector('#hub-profile-edit-tags')?.value),
		links: parseLinksInput(editDialog?.querySelector('#hub-profile-edit-links')?.value),
	}
}

/** @returns {void} */
function loadActiveLocaleForm() {
	const slice = editingLocalized[activeLocaleKey] || {}
	const defaults = editingInfoDefaults || {}
	const nameEl = editDialog?.querySelector('#hub-profile-edit-name')
	if (nameEl instanceof HTMLInputElement)
		nameEl.value = slice.name ?? ''
	const desc = editDialog?.querySelector('#hub-profile-edit-description-markdown')
	if (desc instanceof HTMLTextAreaElement)
		desc.value = slice.description_markdown ?? slice.description ?? ''
	const tags = editDialog?.querySelector('#hub-profile-edit-tags')
	if (tags instanceof HTMLInputElement)
		tags.value = formatTagsInput(slice.tags ?? [])
	const links = editDialog?.querySelector('#hub-profile-edit-links')
	if (links instanceof HTMLTextAreaElement)
		links.value = formatLinksInput(slice.links ?? [])
	const hint = editDialog?.querySelector('[data-profile-default-name]')
	if (hint)
		hint.textContent = defaults.name
			? `${defaults.name} (${defaults.tags?.join(', ') || ''})`.replace(/\s+\(\)$/, '')
			: ''
}

/** @returns {void} */
function refreshLocaleTabs() {
	const host = editDialog?.querySelector('[data-profile-locale-tabs]')
	renderLocaleTabs(host, editingLocalized, activeLocaleKey, {
		/** @param {string} key locale 键 */
		onSelect: (key) => {
			persistActiveLocaleForm()
			activeLocaleKey = key
			loadActiveLocaleForm()
			refreshLocaleTabs()
		},
		/** @param {string} key locale 键 */
		onRemove: (key) => {
			if (Object.keys(editingLocalized).length <= 1) return
			delete editingLocalized[key]
			if (activeLocaleKey === key)
				activeLocaleKey = Object.keys(editingLocalized)[0] || ''
			loadActiveLocaleForm()
			refreshLocaleTabs()
		},
		/**
		 * 新增本地化语言 tab 并切换到该语言表单。
		 * @returns {void}
		 */
		onAdd: () => {
			void (async () => {
				const key = await promptNewLocaleKey(editingLocalized)
				if (!key) return
				persistActiveLocaleForm()
				editingLocalized = ensureLocaleEntry(editingLocalized, key)
				activeLocaleKey = key
				loadActiveLocaleForm()
				refreshLocaleTabs()
			})()
		},
	})
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {object} profile API 返回的 profile
 * @returns {void}
 */
function initEditState(entityHash, profile) {
	editingEntityHash = entityHash
	editingBaseProfile = profile
	editingInfoDefaults = profile.infoDefaults || null
	editingLocalized = { ...profile.localized || {} }
	const keys = Object.keys(editingLocalized)
	if (!keys.length)
		editingLocalized[navigator.language || 'zh-CN'] = {}

	const navLang = String(navigator.language || '').trim()
	activeLocaleKey = keys.find(k => k === navLang)
		|| keys.find(k => navLang && k.split('-')[0] === navLang.split('-')[0])
		|| keys[0]
	const preview = editDialog?.querySelector('#hub-profile-edit-avatar-preview')
	if (preview instanceof HTMLImageElement)
		preview.src = profile.avatar
			|| `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name || entityHash.slice(64, 72))}&size=128`
	const status = editDialog?.querySelector('#hub-profile-edit-status')
	if (status instanceof HTMLSelectElement)
		status.value = profile.status || 'online'
	const custom = editDialog?.querySelector('#hub-profile-edit-custom-status')
	if (custom instanceof HTMLInputElement)
		custom.value = profile.customStatus || ''
	loadActiveLocaleForm()
	refreshLocaleTabs()
}

/** @returns {Promise<void>} */
async function handleSaveProfile() {
	if (!editingEntityHash || !editingBaseProfile || !editDialog) return
	persistActiveLocaleForm()
	const groupId = hubStore.currentGroupId || undefined
	try {
		const updates = {
			localized: editingLocalized,
			status: editDialog.querySelector('#hub-profile-edit-status')?.value || editingBaseProfile.status,
			customStatus: editDialog.querySelector('#hub-profile-edit-custom-status')?.value?.trim() || '',
		}
		const file = editDialog.querySelector('#hub-profile-edit-avatar-upload')?.files?.[0]
		if (file)
			await uploadAvatar(editingEntityHash, file)
		const result = await updateEntityProfileApi(editingEntityHash, updates, groupId)
		if (!result?.profile) throw new Error(result?.error || 'update failed')
		invalidateUserProfileCache(editingEntityHash)
		editDialog.close()
		showToastI18n('success', 'chat.hub.profilePopup.editSaved')
		await onSavedCallback?.()
	}
	catch (error) {
		showToastI18n('error', 'profile.errors.saveFailed', { error: error.message })
	}
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {{ onSaved?: () => void | Promise<void> }} [opts] 保存后回调
 * @returns {Promise<void>}
 */
export async function openHubProfileEdit(entityHash, opts = {}) {
	const { fetchEntityProfileApi: fetchApi } = await import('../src/entityProfileApi.mjs')
	const groupId = hubStore.currentGroupId || undefined
	const dialog = await ensureEditDialog()
	const data = await fetchApi(entityHash, groupId)
	if (!data?.profile) {
		showToastI18n('error', 'profile.errors.loadFailed')
		return
	}
	onSavedCallback = opts.onSaved || null
	initEditState(entityHash, data.profile)
	dialog.showModal()
}
