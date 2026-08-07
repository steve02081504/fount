/**
 * 【文件】public/hub/profileEdit.mjs
 * 【职责】Hub 内资料编辑模态：头像/横幅上传、昵称/简介/标签/链接表单与提交；SFW 双槽编辑。
 * 【原理】`openHubProfileEdit` 弹出编辑对话框并绑定保存/取消；编辑模式 toggle 切换基线 / sfw_* 字段槽，打开时按查看者 `user.sfw` 初始化。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/i18n、../../../../scripts/template、../../../../scripts/toast、../profile/src/endpoints、../src/entityProfileApi、../src/profileLocaleEditor、core/state、presence。
 */
import { getUserSetting } from '/scripts/endpoints/base.mjs'
import { renderTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n, primaryLocale } from '../../../../scripts/i18n/index.mjs'
import { rebuildProfileFromPart, uploadEntityFile } from '../profile/src/endpoints.mjs'
import {
	configureEntityProfileCard,
	paintEntityProfileCard,
} from '../shared/entityProfileCard.mjs'
import { ensureLocaleEntry, renameLocaleEntry } from '../shared/profileLocaleState.mjs'
import { updateEntityProfileApi } from '../src/entityProfileApi.mjs'
import {
	normalizeProfileLinks,
	normalizeProfileTag,
	normalizeProfileTags,
	readLinksEditor,
	renderLinksEditor,
	renderLocaleTabs,
	renderTagsEditor,
} from '../src/profileLocaleEditor.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { applyProfileAvatarToHost } from './core/avatarCover.mjs'
import { store } from './core/state.mjs'
import { refreshHubAfterProfileChange } from './presence.mjs'

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
let editingSfwAvatarPreview = ''
/** @type {string} */
let editingBannerPreview = ''
/** @type {string} */
let editingSfwBannerPreview = ''
/** @type {boolean} */
let editingBannerCleared = false
/** @type {boolean} */
let editingSfwMode = false
/** @type {{ avatar: File | null, banner: File | null }} */
let pendingNormalMedia = { avatar: null, banner: null }
/** @type {{ avatar: File | null, banner: File | null }} */
let pendingSfwMedia = { avatar: null, banner: null }
/** @type {string[]} */
let editingTags = []
/** @type {{ name?: string, url: string, icon?: string }[]} */
let editingLinks = []
/** @type {(() => void | Promise<void>) | null} */
let onSavedCallback = null

/**
 * @returns {{ avatar: File | null, banner: File | null }} 当前模式的待上传文件
 */
function activePendingMedia() {
	return editingSfwMode ? pendingSfwMedia : pendingNormalMedia
}

/**
 * @param {HTMLInputElement} input file input
 * @param {File | null} file 待恢复文件
 * @returns {void}
 */
function restoreFileInput(input, file) {
	input.value = ''
	if (!file) return
	const transfer = new DataTransfer()
	transfer.items.add(file)
	input.files = transfer.files
}

/**
 * @param {Record<string, object>} localized 多语言表
 * @param {'avatar' | 'sfw_avatar'} field 字段
 * @returns {string} 首个非空头像
 */
function firstLocalizedAvatar(localized, field) {
	for (const slice of Object.values(localized || {})) {
		const value = String(slice?.[field] || '').trim()
		if (value) return value
	}
	return ''
}

/**
 * SFW 空则回退普通值。
 * @param {unknown} sfwVal SFW 槽
 * @param {unknown} baseVal 普通槽
 * @returns {string} 展示用字符串
 */
function coalesceSfwString(sfwVal, baseVal) {
	const sfw = String(sfwVal ?? '').trim()
	if (sfw) return sfw
	return String(baseVal ?? '').trim()
}

/**
 * @param {unknown} a 左
 * @param {unknown} b 右
 * @returns {boolean} 规范化后相等
 */
function sameNormalizedText(a, b) {
	return String(a ?? '').trim() === String(b ?? '').trim()
}

/**
 * @param {unknown} a tags/links
 * @param {unknown} b tags/links
 * @returns {boolean} JSON 相等
 */
function sameJsonValue(a, b) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * 空或与普通内容一致的 sfw_* 不落盘。
 * @param {string} sfwVal SFW 值
 * @param {string} baseVal 普通值
 * @returns {string | undefined} 应写入的值；undefined 表示删除键
 */
function pruneSfwString(sfwVal, baseVal) {
	const sfw = String(sfwVal ?? '').trim()
	if (!sfw || sameNormalizedText(sfw, baseVal)) return undefined
	return sfw
}

/**
 * @param {unknown[]} sfwList SFW 列表
 * @param {unknown[]} baseList 普通列表
 * @returns {unknown[] | undefined} 应写入；undefined 删除
 */
function pruneSfwList(sfwList, baseList) {
	if (!Array.isArray(sfwList) || !sfwList.length) return undefined
	if (sameJsonValue(sfwList, baseList || [])) return undefined
	return sfwList
}

/**
 * 从 locale 切片去掉冗余的 sfw_*。
 * @param {object} slice locale 切片
 * @returns {object} 精简后切片
 */
function pruneLocaleSfwFields(slice) {
	const next = { ...slice }
	const name = pruneSfwString(next.sfw_name, next.name)
	if (name === undefined) delete next.sfw_name
	else next.sfw_name = name

	const avatar = pruneSfwString(next.sfw_avatar, next.avatar)
	if (avatar === undefined) delete next.sfw_avatar
	else next.sfw_avatar = avatar

	const desc = pruneSfwString(next.sfw_description, next.description)
	if (desc === undefined) delete next.sfw_description
	else next.sfw_description = desc

	const md = pruneSfwString(next.sfw_description_markdown, next.description_markdown ?? next.description)
	if (md === undefined) delete next.sfw_description_markdown
	else next.sfw_description_markdown = md

	const tags = pruneSfwList(next.sfw_tags, next.tags)
	if (tags === undefined) delete next.sfw_tags
	else next.sfw_tags = tags

	const links = pruneSfwList(next.sfw_links, next.links)
	if (links === undefined) delete next.sfw_links
	else next.sfw_links = links

	return next
}

/** @returns {string} 当前编辑槽头像预览（SFW 空则回退普通） */
function activeAvatarPreview() {
	if (!editingSfwMode) return editingAvatarPreview
	return coalesceSfwString(editingSfwAvatarPreview, editingAvatarPreview)
}

/** @returns {string} 当前编辑槽横幅预览（SFW 空则回退普通） */
function activeBannerPreview() {
	if (!editingSfwMode)
		return editingBannerCleared ? '' : editingBannerPreview
	// SFW 槽清空 = 继承普通横幅（含「已清除普通横幅」）
	return coalesceSfwString(editingSfwBannerPreview, editingBannerCleared ? '' : editingBannerPreview)
}

/**
 * 确保资料编辑对话框已挂载。
 * @returns {Promise<HTMLDialogElement>} 编辑对话框元素
 */
async function ensureEditDialog() {
	if (editDialog?.isConnected) {
		if (editDialog.querySelector('#profile-edit-sfw-mode'))
			return editDialog
		editDialog.remove()
		editDialog = null
	}
	usingTemplates('/parts/shells:chat/src/templates')
	const node = await renderTemplate('hub/profile_edit_modal', {})
	editDialog = node instanceof HTMLDialogElement && node.id === 'profile-edit-modal'
		? node
		: node.querySelector('#profile-edit-modal')
	if (!(editDialog instanceof HTMLDialogElement))
		throw new Error('hub profile edit modal missing')
	document.body.appendChild(node)
	const previewHost = editDialog.querySelector('#profile-edit-live-preview')
	const previewCard = await renderTemplate('hub/profile_popup', {})
	if (previewHost && previewCard instanceof HTMLElement) {
		configureEntityProfileCard(previewCard, 'preview')
		previewHost.appendChild(previewCard)
	}

	editDialog.querySelector('#profile-edit-cancel')?.addEventListener('click', () => editDialog?.close())
	editDialog.querySelector('#profile-edit-close')?.addEventListener('click', () => editDialog?.close())
	editDialog.querySelector('#profile-edit-save')?.addEventListener('click', () => { void handleSaveProfile() })
	editDialog.querySelector('#profile-edit-reset-from-part')?.addEventListener('click', () => {
		void handleResetFromPart()
	})
	editDialog.querySelector('#profile-edit-sfw-mode')?.addEventListener('change', (event) => {
		const checked = !!(event.target instanceof HTMLInputElement && event.target.checked)
		switchEditSfwMode(checked)
	})
	editDialog.querySelector('#profile-edit-avatar-upload')?.addEventListener('change', (event) => {
		const file = event.target?.files?.[0]
		if (!file) return
		activePendingMedia().avatar = file
		const reader = new FileReader()
		/** @param {ProgressEvent<FileReader>} loadEvent 读取完成 */
		reader.onload = (loadEvent) => {
			if (!loadEvent.target?.result) return
			const value = String(loadEvent.target.result)
			if (editingSfwMode) editingSfwAvatarPreview = value
			else editingAvatarPreview = value
			renderEditPreview()
		}
		reader.readAsDataURL(file)
	})
	editDialog.querySelector('#profile-edit-avatar-url')?.addEventListener('input', (event) => {
		const upload = editDialog?.querySelector('#profile-edit-avatar-upload')
		if (upload instanceof HTMLInputElement) upload.value = ''
		activePendingMedia().avatar = null
		const value = event.target?.value?.trim() || ''
		if (editingSfwMode) editingSfwAvatarPreview = value
		else editingAvatarPreview = value
		renderEditPreview()
	})
	editDialog.querySelector('#profile-edit-banner-upload')?.addEventListener('change', (event) => {
		const file = event.target?.files?.[0]
		if (!file) return
		activePendingMedia().banner = file
		const reader = new FileReader()
		/** @param {ProgressEvent<FileReader>} loadEvent 读取完成 */
		reader.onload = (loadEvent) => {
			if (!loadEvent.target?.result) return
			const value = String(loadEvent.target.result)
			if (editingSfwMode)
				editingSfwBannerPreview = value
			else {
				editingBannerPreview = value
				editingBannerCleared = false
			}
			renderEditPreview()
		}
		reader.readAsDataURL(file)
	})
	editDialog.querySelector('#profile-edit-banner-url')?.addEventListener('input', (event) => {
		const upload = editDialog?.querySelector('#profile-edit-banner-upload')
		if (upload instanceof HTMLInputElement) upload.value = ''
		activePendingMedia().banner = null
		const value = event.target?.value?.trim() || ''
		if (editingSfwMode)
			editingSfwBannerPreview = value
		else {
			editingBannerPreview = value
			editingBannerCleared = !value
		}
		renderEditPreview()
	})
	editDialog.querySelector('#profile-edit-banner-clear')?.addEventListener('click', () => {
		if (editingSfwMode)
			editingSfwBannerPreview = ''
		else {
			editingBannerPreview = ''
			editingBannerCleared = true
		}
		activePendingMedia().banner = null
		const upload = editDialog?.querySelector('#profile-edit-banner-upload')
		if (upload instanceof HTMLInputElement) upload.value = ''
		const url = editDialog?.querySelector('#profile-edit-banner-url')
		if (url instanceof HTMLInputElement)
			// SFW 清空 = 继承普通横幅；普通清空 = 无横幅
			url.value = activeBannerPreview()
		renderEditPreview()
	})
	editDialog.querySelector('#profile-edit-tag-add')?.addEventListener('click', () => addTagFromInput())
	editDialog.querySelector('#profile-edit-tag-input')?.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return
		event.preventDefault()
		addTagFromInput()
	})
	editDialog.querySelector('#profile-edit-link-add')?.addEventListener('click', () => {
		editingLinks = [...readLinksEditor(editDialog?.querySelector('[data-profile-links-editor]'), { keepEmpty: true }), { name: '', url: '', icon: '' }]
		paintLinksEditor()
		renderEditPreview()
	})
	editDialog.querySelector('.profile-edit-form')?.addEventListener('input', renderEditPreview)
	editDialog.querySelector('.profile-edit-form')?.addEventListener('change', renderEditPreview)
	return editDialog
}

/**
 * @param {boolean} next 是否编辑 SFW 槽
 * @returns {void}
 */
function switchEditSfwMode(next) {
	if (next === editingSfwMode) return
	persistActiveLocaleForm()
	persistActiveMediaFields()
	editingSfwMode = next
	loadActiveMediaFields()
	loadActiveLocaleForm()
	renderEditPreview()
}

/** @returns {void} */
function persistActiveMediaFields() {
	const avatarUrl = editDialog?.querySelector('#profile-edit-avatar-url')
	const bannerUrl = editDialog?.querySelector('#profile-edit-banner-url')
	const avatarValue = avatarUrl instanceof HTMLInputElement ? avatarUrl.value.trim() : ''
	const bannerValue = bannerUrl instanceof HTMLInputElement ? bannerUrl.value.trim() : ''
	const avatarUpload = editDialog?.querySelector('#profile-edit-avatar-upload')
	const bannerUpload = editDialog?.querySelector('#profile-edit-banner-upload')
	const pending = activePendingMedia()
	if (avatarUpload instanceof HTMLInputElement && avatarUpload.files?.[0])
		pending.avatar = avatarUpload.files[0]
	if (bannerUpload instanceof HTMLInputElement && bannerUpload.files?.[0])
		pending.banner = bannerUpload.files[0]
	const hasPendingAvatar = !!pending.avatar
	const hasPendingBanner = !!pending.banner
	if (editingSfwMode) {
		// 空或与普通一致 → 不存 SFW 槽（回退普通）；有未保存上传时保留预览
		const nextAvatar = hasPendingAvatar && !avatarValue ? editingSfwAvatarPreview : avatarValue
		const nextBanner = hasPendingBanner && !bannerValue ? editingSfwBannerPreview : bannerValue
		editingSfwAvatarPreview = pruneSfwString(nextAvatar, editingAvatarPreview) || ''
		editingSfwBannerPreview = pruneSfwString(nextBanner, editingBannerCleared ? '' : editingBannerPreview) || ''
	}
	else {
		editingAvatarPreview = hasPendingAvatar && !avatarValue ? editingAvatarPreview : avatarValue
		if (!editingBannerCleared)
			editingBannerPreview = bannerValue || editingBannerPreview
	}
}

/** @returns {void} */
function loadActiveMediaFields() {
	const pending = activePendingMedia()
	const avatarUpload = editDialog?.querySelector('#profile-edit-avatar-upload')
	if (avatarUpload instanceof HTMLInputElement) restoreFileInput(avatarUpload, pending.avatar)
	const bannerUpload = editDialog?.querySelector('#profile-edit-banner-upload')
	if (bannerUpload instanceof HTMLInputElement) restoreFileInput(bannerUpload, pending.banner)
	const avatarUrl = editDialog?.querySelector('#profile-edit-avatar-url')
	if (avatarUrl instanceof HTMLInputElement)
		avatarUrl.value = activeAvatarPreview()
	const bannerUrl = editDialog?.querySelector('#profile-edit-banner-url')
	if (bannerUrl instanceof HTMLInputElement)
		bannerUrl.value = activeBannerPreview()
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
	const input = editDialog?.querySelector('#profile-edit-tag-input')
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
	const md = editDialog?.querySelector('#profile-edit-description-markdown')?.value ?? ''
	const prev = editingLocalized[activeLocaleKey] || {}
	const name = editDialog?.querySelector('#profile-edit-name')?.value?.trim() || ''
	const description = md.replace(/[#*[\]_`]/g, '').trim()
	const tags = normalizeProfileTags(editingTags)
	const links = readLinksFromForm()
	if (editingSfwMode) {
		const next = { ...prev }
		const sfwName = pruneSfwString(name, prev.name)
		if (sfwName === undefined) delete next.sfw_name
		else next.sfw_name = sfwName
		const sfwMd = pruneSfwString(md, prev.description_markdown ?? prev.description)
		if (sfwMd === undefined) {
			delete next.sfw_description_markdown
			delete next.sfw_description
		}
		else {
			next.sfw_description_markdown = sfwMd
			next.sfw_description = description
		}
		const sfwTags = pruneSfwList(tags, prev.tags)
		if (sfwTags === undefined) delete next.sfw_tags
		else next.sfw_tags = sfwTags
		const sfwLinks = pruneSfwList(links, prev.links)
		if (sfwLinks === undefined) delete next.sfw_links
		else next.sfw_links = sfwLinks
		editingLocalized[activeLocaleKey] = next
	}
	else
		editingLocalized[activeLocaleKey] = {
			...prev,
			name,
			description_markdown: md,
			description,
			tags,
			links,
		}
}

/** @returns {void} */
function loadActiveLocaleForm() {
	const slice = editingLocalized[activeLocaleKey] || {}
	const defaults = editingInfoDefaults || {}
	const nameElement = editDialog?.querySelector('#profile-edit-name')
	const desc = editDialog?.querySelector('#profile-edit-description-markdown')
	if (editingSfwMode) {
		if (nameElement instanceof HTMLInputElement)
			nameElement.value = coalesceSfwString(slice.sfw_name, slice.name)
		if (desc instanceof HTMLTextAreaElement) {
			const baseMd = slice.description_markdown ?? slice.description ?? ''
			const sfwMd = slice.sfw_description_markdown ?? slice.sfw_description ?? ''
			desc.value = coalesceSfwString(sfwMd, baseMd)
		}
		editingTags = normalizeProfileTags(
			Array.isArray(slice.sfw_tags) && slice.sfw_tags.length
				? slice.sfw_tags
				: Array.isArray(slice.tags) ? slice.tags : defaults.tags ?? [],
		)
		editingLinks = normalizeProfileLinks(
			Array.isArray(slice.sfw_links) && slice.sfw_links.length
				? slice.sfw_links
				: Array.isArray(slice.links) ? slice.links : defaults.links ?? [],
		)
	}
	else {
		if (nameElement instanceof HTMLInputElement)
			nameElement.value = slice.name ?? ''
		if (desc instanceof HTMLTextAreaElement)
			desc.value = slice.description_markdown ?? slice.description ?? ''
		editingTags = normalizeProfileTags(
			Array.isArray(slice.tags) ? slice.tags : defaults.tags ?? [],
		)
		editingLinks = normalizeProfileLinks(
			Array.isArray(slice.links) ? slice.links : defaults.links ?? [],
		)
	}
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
 * 按当前表单值实时刷新资料卡预览（跟随编辑模式，非全局 user.sfw）。
 * @returns {void}
 */
function renderEditPreview() {
	if (!editDialog || !editingEntityHash) return
	const defaults = editingInfoDefaults || {}
	const name = editDialog.querySelector('#profile-edit-name')?.value?.trim()
		|| (editingSfwMode ? '' : defaults.name)
		|| editingBaseProfile?.name
		|| editingEntityHash.slice(64, 72)
	const handle = editDialog.querySelector('#profile-edit-handle')?.value?.trim()
	const status = editDialog.querySelector('#profile-edit-status')?.value || 'offline'
	const customStatus = editDialog.querySelector('#profile-edit-custom-status')?.value?.trim()
	const description = editDialog.querySelector('#profile-edit-description-markdown')?.value?.trim()
	const themeColor = editDialog.querySelector('#profile-edit-theme-color')?.value || '#5865f2'
	const links = readLinksFromForm()
	const banner = activeBannerPreview()
	const avatar = activeAvatarPreview()

	const card = editDialog.querySelector('#profile-edit-live-preview .profile-popup')
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
			displayBanner: banner,
			tags: editingTags,
			links,
		}, {
			entityHash: editingEntityHash,
			avatarOverride: avatar,
			bannerOverride: banner,
		})
	const swatch = editDialog.querySelector('#profile-edit-avatar-swatch')
	if (swatch instanceof HTMLElement)
		void applyProfileAvatarToHost(swatch, {
			seed: editingEntityHash,
			label: name,
			avatar,
			letterClass: 'profile-preview-avatar-letter',
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
 * @param {{ initialSfwMode?: boolean }} [options] 初始化选项
 * @returns {void}
 */
function initEditState(entityHash, profile, { initialSfwMode = false } = {}) {
	editingEntityHash = entityHash
	editingBaseProfile = profile
	editingInfoDefaults = profile.infoDefaults || null
	editingSfwMode = initialSfwMode
	editingLocalized = { ...profile.localized }
	editingAvatarPreview = firstLocalizedAvatar(editingLocalized, 'avatar') || String(profile.avatar || '').trim()
	editingSfwAvatarPreview = firstLocalizedAvatar(editingLocalized, 'sfw_avatar')
	editingBannerPreview = String(profile.banner || '').trim()
	editingSfwBannerPreview = String(profile.sfw_banner || '').trim()
	editingBannerCleared = false
	pendingNormalMedia = { avatar: null, banner: null }
	pendingSfwMedia = { avatar: null, banner: null }
	let keys = Object.keys(editingLocalized)
	if (!keys.length)
		editingLocalized[primaryLocale()] = {}
	keys = Object.keys(editingLocalized)

	const preferred = primaryLocale()
	activeLocaleKey = keys.find(k => k === preferred)
		|| keys.find(k => preferred && k.split('-')[0] === preferred.split('-')[0])
		|| keys[0]
	const sfwToggle = editDialog?.querySelector('#profile-edit-sfw-mode')
	if (sfwToggle instanceof HTMLInputElement) sfwToggle.checked = initialSfwMode
	loadActiveMediaFields()
	const status = editDialog?.querySelector('#profile-edit-status')
	if (status instanceof HTMLSelectElement)
		status.value = profile.status || 'online'
	const custom = editDialog?.querySelector('#profile-edit-custom-status')
	if (custom instanceof HTMLInputElement)
		custom.value = profile.customStatus || ''
	const handle = editDialog?.querySelector('#profile-edit-handle')
	if (handle instanceof HTMLInputElement)
		handle.value = profile.handle || ''
	const theme = editDialog?.querySelector('#profile-edit-theme-color')
	if (theme instanceof HTMLInputElement)
		theme.value = profile.themeColor || '#5865f2'
	const resetButton = editDialog?.querySelector('#profile-edit-reset-from-part')
	if (resetButton instanceof HTMLButtonElement)
		resetButton.hidden = !profile.charPartName
	loadActiveLocaleForm()
	refreshLocaleTabs()
	renderEditPreview()
}

/**
 * 从角色 part info 强制重建当前编辑中的 agent 资料。
 * @returns {Promise<void>}
 */
async function handleResetFromPart() {
	if (!editingEntityHash || !editingBaseProfile?.charPartName || !editDialog) return
	if (!confirmI18n('chat.hub.profileEdit.resetFrom.partConfirm')) return
	const groupId = store.context.currentGroupId || undefined
	try {
		const data = await rebuildProfileFromPart(editingEntityHash, groupId)
		if (!data?.profile) throw new Error(data?.error || 'rebuild failed')
		initEditState(editingEntityHash, data.profile, { initialSfwMode: editingSfwMode })
		showToastI18n('success', 'chat.hub.profileEdit.resetFrom.partDone')
		await refreshHubAfterProfileChange(editingEntityHash)
		await onSavedCallback?.()
	}
	catch (error) {
		handleUIError(error, 'chat.hub.profileEdit.resetFrom.partFailed')
	}
}

/** @returns {Promise<void>} */
async function handleSaveProfile() {
	if (!editingEntityHash || !editingBaseProfile || !editDialog) return
	persistActiveLocaleForm()
	persistActiveMediaFields()
	const groupId = store.context.currentGroupId || undefined
	const sfw = editingSfwMode
	const pending = activePendingMedia()
	try {
		const avatarFile = editDialog.querySelector('#profile-edit-avatar-upload')?.files?.[0] || pending.avatar
		let avatarQueued = false
		if (avatarFile) {
			const avatarPath = sfw ? 'profile/sfw_avatar' : 'profile/avatar'
			const avatarResult = await uploadEntityFile(editingEntityHash, avatarPath, avatarFile)
			if (avatarResult?.queued) {
				avatarQueued = true
				// 媒体已走主人 EVFS 入队；丢掉 FileReader 临时 data URL，避免写进后续 profile 负载
				if (sfw)
					editingSfwAvatarPreview = firstLocalizedAvatar(editingLocalized, 'sfw_avatar')
				else
					editingAvatarPreview = firstLocalizedAvatar(editingLocalized, 'avatar')
						|| String(editingBaseProfile?.avatar || '').trim()
			}
			else if (avatarResult?.url)
				if (sfw) editingSfwAvatarPreview = avatarResult.url
				else editingAvatarPreview = avatarResult.url

			pending.avatar = null
		}

		const bannerFile = editDialog.querySelector('#profile-edit-banner-upload')?.files?.[0] || pending.banner
		let bannerQueued = false
		if (bannerFile && (sfw || !editingBannerCleared)) {
			const bannerPath = sfw ? 'profile/sfw_banner' : 'profile/banner'
			const bannerResult = await uploadEntityFile(editingEntityHash, bannerPath, bannerFile)
			if (bannerResult?.queued) {
				bannerQueued = true
				if (sfw)
					editingSfwBannerPreview = String(editingBaseProfile?.sfw_banner || '').trim()
				else
					editingBannerPreview = String(editingBaseProfile?.banner || '').trim()
			}
			else if (bannerResult?.url)
				if (sfw)
					editingSfwBannerPreview = bannerResult.url
				else {
					editingBannerPreview = bannerResult.url
					editingBannerCleared = false
				}

			pending.banner = null
		}
		else if (!sfw && editingBannerCleared) {
			editingBannerPreview = ''
			editingBannerCleared = true
		}

		// 把当前媒体槽写回 active locale，并去掉与普通内容重复的 sfw_*
		const localeKey = activeLocaleKey
		if (localeKey) {
			const slice = { ...editingLocalized[localeKey] }
			if (sfw) {
				const sfwAvatar = pruneSfwString(editingSfwAvatarPreview, editingAvatarPreview)
				if (sfwAvatar === undefined) delete slice.sfw_avatar
				else slice.sfw_avatar = sfwAvatar
			}
			else
				slice.avatar = editingAvatarPreview
			editingLocalized = {
				...editingLocalized,
				[localeKey]: pruneLocaleSfwFields(slice),
			}
		}
		editingSfwAvatarPreview = firstLocalizedAvatar(editingLocalized, 'sfw_avatar')

		const banner = editingBannerCleared ? '' : editingBannerPreview
		const sfw_banner = pruneSfwString(editingSfwBannerPreview, banner) || ''
		editingSfwBannerPreview = sfw_banner

		const updates = {
			localized: editingLocalized,
			handle: editDialog.querySelector('#profile-edit-handle')?.value?.trim() || '',
			themeColor: editDialog.querySelector('#profile-edit-theme-color')?.value || '',
			status: editDialog.querySelector('#profile-edit-status')?.value || editingBaseProfile.status,
			customStatus: editDialog.querySelector('#profile-edit-custom-status')?.value?.trim() || '',
			banner,
			sfw_banner,
		}
		const result = await updateEntityProfileApi(editingEntityHash, updates, groupId)
		const queued = !!(result?.queued || avatarQueued || bannerQueued)
		if (!queued && !result?.profile) throw new Error(result?.error || 'update failed')
		editDialog.close()
		showToastI18n('success', queued
			? 'chat.hub.profilePopup.editQueued'
			: 'chat.hub.profilePopup.editSaved')
		await refreshHubAfterProfileChange(editingEntityHash)
		await onSavedCallback?.()
	}
	catch (error) {
		handleUIError(error, 'chat.profile.errors.saveFailed')
	}
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {{ onSaved?: () => void | Promise<void> }} [options] 保存后回调
 * @returns {Promise<void>}
 */
export async function openHubProfileEdit(entityHash, options = {}) {
	const { fetchEntityProfileApi: fetchApi } = await import('../src/entityProfileApi.mjs')
	const groupId = store.context.currentGroupId || undefined
	const dialog = await ensureEditDialog()
	const data = await fetchApi(entityHash, groupId)
	if (!data?.profile) {
		showToastI18n('error', 'chat.profile.errors.loadFailed')
		return
	}
	onSavedCallback = options.onSaved || null
	const initialSfwMode = !!await getUserSetting('sfw').catch(() => false)
	initEditState(entityHash, data.profile, { initialSfwMode })
	dialog.showModal()
}
