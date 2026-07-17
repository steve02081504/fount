/**
 * 【文件】public/hub/profileEdit.mjs
 * 【职责】Hub 内资料编辑模态：头像/横幅上传、昵称/简介/标签/链接表单与提交。
 * 【原理】`openHubProfileEdit` 弹出编辑对话框并绑定保存/取消；成功后刷新顶栏与成员展示。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/i18n、../../../../scripts/template、../../../../scripts/toast、../profile/src/endpoints、../src/entityProfileApi、../src/profileLocaleEditor、core/state、presence。
 */
import { renderTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { uploadAvatar, uploadBanner } from '../profile/src/endpoints.mjs'
import {
	configureEntityProfileCard,
	paintEntityProfileCard,
} from '../shared/entityProfileCard.mjs'
import { customProfileAvatar } from '../shared/hashAvatar.mjs'
import { updateEntityProfileApi } from '../src/entityProfileApi.mjs'
import {
	ensureLocaleEntry,
	normalizeProfileLinks,
	normalizeProfileTag,
	normalizeProfileTags,
	readLinksEditor,
	renameLocaleEntry,
	renderLinksEditor,
	renderLocaleTabs,
	renderTagsEditor,
} from '../src/profileLocaleEditor.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { applyProfileAvatarToHost } from './core/avatarCover.mjs'
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
/** @type {string} */
let editingAvatarPreview = ''
/** @type {string} */
let editingBannerPreview = ''
/** @type {boolean} */
let editingBannerCleared = false
/** @type {string[]} */
let editingTags = []
/** @type {{ name?: string, url: string, icon?: string }[]} */
let editingLinks = []
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
	const previewHost = editDialog.querySelector('#hub-profile-edit-live-preview')
	const previewCard = await renderTemplate('hub/profile_popup', {})
	if (previewHost && previewCard instanceof HTMLElement) {
		configureEntityProfileCard(previewCard, 'preview')
		previewHost.appendChild(previewCard)
	}

	editDialog.querySelector('#hub-profile-edit-cancel')?.addEventListener('click', () => editDialog?.close())
	editDialog.querySelector('#hub-profile-edit-close')?.addEventListener('click', () => editDialog?.close())
	editDialog.querySelector('#hub-profile-edit-save')?.addEventListener('click', () => { void handleSaveProfile() })
	editDialog.querySelector('#hub-profile-edit-avatar-upload')?.addEventListener('change', (event) => {
		const file = event.target?.files?.[0]
		if (!file) return
		const reader = new FileReader()
		/** @param {ProgressEvent<FileReader>} loadEvent 读取完成 */
		reader.onload = (loadEvent) => {
			if (!loadEvent.target?.result) return
			editingAvatarPreview = String(loadEvent.target.result)
			renderEditPreview()
		}
		reader.readAsDataURL(file)
	})
	editDialog.querySelector('#hub-profile-edit-avatar-url')?.addEventListener('input', (event) => {
		const upload = editDialog?.querySelector('#hub-profile-edit-avatar-upload')
		if (upload instanceof HTMLInputElement) upload.value = ''
		editingAvatarPreview = event.target?.value?.trim() || ''
		renderEditPreview()
	})
	editDialog.querySelector('#hub-profile-edit-banner-upload')?.addEventListener('change', (event) => {
		const file = event.target?.files?.[0]
		if (!file) return
		const reader = new FileReader()
		/** @param {ProgressEvent<FileReader>} loadEvent 读取完成 */
		reader.onload = (loadEvent) => {
			if (!loadEvent.target?.result) return
			editingBannerPreview = String(loadEvent.target.result)
			editingBannerCleared = false
			renderEditPreview()
		}
		reader.readAsDataURL(file)
	})
	editDialog.querySelector('#hub-profile-edit-banner-url')?.addEventListener('input', (event) => {
		const upload = editDialog?.querySelector('#hub-profile-edit-banner-upload')
		if (upload instanceof HTMLInputElement) upload.value = ''
		editingBannerPreview = event.target?.value?.trim() || ''
		editingBannerCleared = !editingBannerPreview
		renderEditPreview()
	})
	editDialog.querySelector('#hub-profile-edit-banner-clear')?.addEventListener('click', () => {
		editingBannerPreview = ''
		editingBannerCleared = true
		const url = editDialog?.querySelector('#hub-profile-edit-banner-url')
		if (url instanceof HTMLInputElement) url.value = ''
		const upload = editDialog?.querySelector('#hub-profile-edit-banner-upload')
		if (upload instanceof HTMLInputElement) upload.value = ''
		renderEditPreview()
	})
	editDialog.querySelector('#hub-profile-edit-tag-add')?.addEventListener('click', () => addTagFromInput())
	editDialog.querySelector('#hub-profile-edit-tag-input')?.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return
		event.preventDefault()
		addTagFromInput()
	})
	editDialog.querySelector('#hub-profile-edit-link-add')?.addEventListener('click', () => {
		editingLinks = [...readLinksEditor(editDialog?.querySelector('[data-profile-links-editor]'), { keepEmpty: true }), { name: '', url: '', icon: '' }]
		paintLinksEditor()
		renderEditPreview()
	})
	editDialog.querySelector('.hub-profile-edit-form')?.addEventListener('input', renderEditPreview)
	editDialog.querySelector('.hub-profile-edit-form')?.addEventListener('change', renderEditPreview)
	return editDialog
}

/**
 * @param {string} key 新 locale 代码
 * @returns {void}
 */
function addLocale(key) {
	const next = String(key || '').trim()
	if (!next) return
	persistActiveLocaleForm()
	if (editingLocalized[next])
		activeLocaleKey = next
	else {
		editingLocalized = ensureLocaleEntry(editingLocalized, next, activeLocaleKey)
		activeLocaleKey = next
	}
	loadActiveLocaleForm()
	refreshLocaleTabs()
}

/**
 * @param {string} oldKey 原代码
 * @param {string} newKey 新代码
 * @returns {void}
 */
function renameLocale(oldKey, newKey) {
	persistActiveLocaleForm()
	const renamed = renameLocaleEntry(editingLocalized, oldKey, newKey)
	if (renamed !== editingLocalized) {
		editingLocalized = renamed
		if (activeLocaleKey === oldKey) activeLocaleKey = newKey
		loadActiveLocaleForm()
	}
	refreshLocaleTabs()
}

/** @returns {void} */
function addTagFromInput() {
	const input = editDialog?.querySelector('#hub-profile-edit-tag-input')
	if (!(input instanceof HTMLInputElement)) return
	const tag = normalizeProfileTag(input.value)
	if (!tag) return
	if (!editingTags.includes(tag))
		editingTags = [...editingTags, tag]
	input.value = ''
	paintTagsEditor()
	renderEditPreview()
}

/** @returns {void} */
function paintTagsEditor() {
	const host = editDialog?.querySelector('[data-profile-tags-editor]')
	if (!(host instanceof HTMLElement)) return
	renderTagsEditor(host, editingTags, (next) => {
		editingTags = normalizeProfileTags(next)
		paintTagsEditor()
		renderEditPreview()
	})
}

/** @returns {void} */
function paintLinksEditor() {
	const host = editDialog?.querySelector('[data-profile-links-editor]')
	if (!(host instanceof HTMLElement)) return
	renderLinksEditor(host, editingLinks, (next, meta = {}) => {
		editingLinks = next.length ? next : [{ name: '', url: '', icon: '' }]
		if (meta.rebuild) paintLinksEditor()
		renderEditPreview()
	})
}

/**
 * @returns {{ name?: string, url: string, icon?: string }[]} 当前链接表单值
 */
function readLinksFromForm() {
	const host = editDialog?.querySelector('[data-profile-links-editor]')
	return normalizeProfileLinks(readLinksEditor(host))
}

/** @returns {void} */
function persistActiveLocaleForm() {
	if (!activeLocaleKey) return
	const md = editDialog?.querySelector('#hub-profile-edit-description-markdown')?.value ?? ''
	editingLocalized[activeLocaleKey] = {
		name: editDialog?.querySelector('#hub-profile-edit-name')?.value?.trim() || '',
		description_markdown: md,
		description: md.replace(/[#*[\]_`]/g, '').trim(),
		tags: normalizeProfileTags(editingTags),
		links: readLinksFromForm(),
	}
}

/** @returns {void} */
function loadActiveLocaleForm() {
	const slice = editingLocalized[activeLocaleKey] || {}
	const defaults = editingInfoDefaults || {}
	const nameElement = editDialog?.querySelector('#hub-profile-edit-name')
	if (nameElement instanceof HTMLInputElement)
		nameElement.value = slice.name ?? ''
	const desc = editDialog?.querySelector('#hub-profile-edit-description-markdown')
	if (desc instanceof HTMLTextAreaElement)
		desc.value = slice.description_markdown ?? slice.description ?? ''
	editingTags = normalizeProfileTags(
		Array.isArray(slice.tags) ? slice.tags : defaults.tags ?? [],
	)
	editingLinks = normalizeProfileLinks(
		Array.isArray(slice.links) ? slice.links : defaults.links ?? [],
	)
	if (!editingLinks.length) editingLinks = [{ name: '', url: '', icon: '' }]
	paintTagsEditor()
	paintLinksEditor()
	const hint = editDialog?.querySelector('[data-profile-default-name]')
	if (hint)
		hint.textContent = defaults.name
			? `${defaults.name} (${defaults.tags?.join(', ') || ''})`.replace(/\s+\(\)$/, '')
			: ''
	renderEditPreview()
}

/**
 * 按当前表单值实时刷新资料卡预览。
 * @returns {void}
 */
function renderEditPreview() {
	if (!editDialog || !editingEntityHash) return
	const defaults = editingInfoDefaults || {}
	const name = editDialog.querySelector('#hub-profile-edit-name')?.value?.trim()
		|| defaults.name
		|| editingBaseProfile?.name
		|| editingEntityHash.slice(64, 72)
	const handle = editDialog.querySelector('#hub-profile-edit-handle')?.value?.trim()
	const status = editDialog.querySelector('#hub-profile-edit-status')?.value || 'offline'
	const customStatus = editDialog.querySelector('#hub-profile-edit-custom-status')?.value?.trim()
	const description = editDialog.querySelector('#hub-profile-edit-description-markdown')?.value?.trim()
	const themeColor = editDialog.querySelector('#hub-profile-edit-theme-color')?.value || '#5865f2'
	const links = readLinksFromForm()
	const banner = editingBannerCleared
		? ''
		: editingBannerPreview || editingBaseProfile?.banner || ''

	const card = editDialog.querySelector('#hub-profile-edit-live-preview .hub-profile-popup')
	if (card instanceof HTMLElement)
		void paintEntityProfileCard(card, {
			...editingBaseProfile,
			entityHash: editingEntityHash,
			name,
			handle,
			status,
			effectiveStatus: status,
			customStatus,
			description,
			description_markdown: description,
			themeColor,
			banner,
			tags: editingTags,
			links,
		}, {
			entityHash: editingEntityHash,
			avatarOverride: editingAvatarPreview,
			bannerOverride: banner,
		})
	const swatch = editDialog.querySelector('#hub-profile-edit-avatar-swatch')
	if (swatch instanceof HTMLElement)
		void applyProfileAvatarToHost(swatch, {
			seed: editingEntityHash,
			label: name,
			avatar: editingAvatarPreview,
			letterClass: 'hub-profile-preview-avatar-letter',
		})
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
		onRename: renameLocale,
		onAdd: addLocale,
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
	editingAvatarPreview = customProfileAvatar(profile)
	editingBannerPreview = String(profile.banner || '').trim()
	editingBannerCleared = false
	editingLocalized = { ...profile.localized || {} }
	let keys = Object.keys(editingLocalized)
	if (!keys.length)
		editingLocalized[navigator.language || 'zh-CN'] = {}
	keys = Object.keys(editingLocalized)

	const navLang = String(navigator.language || '').trim()
	activeLocaleKey = keys.find(k => k === navLang)
		|| keys.find(k => navLang && k.split('-')[0] === navLang.split('-')[0])
		|| keys[0]
	const avatarUpload = editDialog?.querySelector('#hub-profile-edit-avatar-upload')
	if (avatarUpload instanceof HTMLInputElement) avatarUpload.value = ''
	const avatarUrl = editDialog?.querySelector('#hub-profile-edit-avatar-url')
	if (avatarUrl instanceof HTMLInputElement) avatarUrl.value = editingAvatarPreview
	const bannerUpload = editDialog?.querySelector('#hub-profile-edit-banner-upload')
	if (bannerUpload instanceof HTMLInputElement) bannerUpload.value = ''
	const bannerUrl = editDialog?.querySelector('#hub-profile-edit-banner-url')
	if (bannerUrl instanceof HTMLInputElement) bannerUrl.value = editingBannerPreview
	const status = editDialog?.querySelector('#hub-profile-edit-status')
	if (status instanceof HTMLSelectElement)
		status.value = profile.status || 'online'
	const custom = editDialog?.querySelector('#hub-profile-edit-custom-status')
	if (custom instanceof HTMLInputElement)
		custom.value = profile.customStatus || ''
	const handle = editDialog?.querySelector('#hub-profile-edit-handle')
	if (handle instanceof HTMLInputElement)
		handle.value = profile.handle || ''
	const theme = editDialog?.querySelector('#hub-profile-edit-theme-color')
	if (theme instanceof HTMLInputElement)
		theme.value = profile.themeColor || '#5865f2'
	loadActiveLocaleForm()
	refreshLocaleTabs()
	renderEditPreview()
}

/** @returns {Promise<void>} */
async function handleSaveProfile() {
	if (!editingEntityHash || !editingBaseProfile || !editDialog) return
	persistActiveLocaleForm()
	const groupId = hubStore.context.currentGroupId || undefined
	try {
		const avatarFile = editDialog.querySelector('#hub-profile-edit-avatar-upload')?.files?.[0]
		const avatarUrl = avatarFile
			? (await uploadAvatar(editingEntityHash, avatarFile)).avatarUrl
			: editDialog.querySelector('#hub-profile-edit-avatar-url')?.value?.trim() || ''
		editingLocalized = Object.fromEntries(
			Object.entries(editingLocalized).map(([key, slice]) => [
				key,
				{ ...slice, avatar: avatarUrl },
			]),
		)
		const bannerFile = editDialog.querySelector('#hub-profile-edit-banner-upload')?.files?.[0]
		const banner = bannerFile && !editingBannerCleared
			? (await uploadBanner(editingEntityHash, bannerFile)).bannerUrl
			: editDialog.querySelector('#hub-profile-edit-banner-url')?.value?.trim() || ''
		const updates = {
			localized: editingLocalized,
			handle: editDialog.querySelector('#hub-profile-edit-handle')?.value?.trim() || '',
			themeColor: editDialog.querySelector('#hub-profile-edit-theme-color')?.value || '',
			status: editDialog.querySelector('#hub-profile-edit-status')?.value || editingBaseProfile.status,
			customStatus: editDialog.querySelector('#hub-profile-edit-custom-status')?.value?.trim() || '',
			banner,
		}
		const result = await updateEntityProfileApi(editingEntityHash, updates, groupId)
		if (!result?.profile) throw new Error(result?.error || 'update failed')
		invalidateUserProfileCache(editingEntityHash)
		editDialog.close()
		showToastI18n('success', 'chat.hub.profilePopup.editSaved')
		await onSavedCallback?.()
	}
	catch (error) {
		handleUIError(error, 'profile.errors.saveFailed')
	}
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {{ onSaved?: () => void | Promise<void> }} [options] 保存后回调
 * @returns {Promise<void>}
 */
export async function openHubProfileEdit(entityHash, options = {}) {
	const { fetchEntityProfileApi: fetchApi } = await import('../src/entityProfileApi.mjs')
	const groupId = hubStore.context.currentGroupId || undefined
	const dialog = await ensureEditDialog()
	const data = await fetchApi(entityHash, groupId)
	if (!data?.profile) {
		showToastI18n('error', 'profile.errors.loadFailed')
		return
	}
	onSavedCallback = options.onSaved || null
	initEditState(entityHash, data.profile)
	dialog.showModal()
}
