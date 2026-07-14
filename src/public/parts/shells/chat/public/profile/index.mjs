/**
 * 【文件】public/profile/index.mjs
 * 【职责】实体资料独立页：按 URL 中 entityHash 拉取并渲染多语言简介、链接与编辑入口。
 * 【原理】getProfile + 模板 profile/*；onLanguageChange 刷新；可跳转 Hub profileEdit；挂载联邦设置面板。
 * 【数据结构】currentEntityHash、currentProfile；localized 各 locale 字段。
 * 【关联】profile/src/endpoints.mjs、federationSettingsPanel.mjs；hub/entityProfile.mjs、profileEdit.mjs。
 */
import {
	mountTemplate,
	renderTemplate,
	usingTemplates,
} from '../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../scripts/features/toast.mjs'
import { initTranslations, onLanguageChange } from '../../../scripts/i18n/index.mjs'
import { applyTheme } from '../../../scripts/theme/index.mjs'
import { profileDescriptionText } from '../hub/entityProfile.mjs'
import { openHubProfileEdit } from '../hub/profileEdit.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { initProfileFederationSettings } from './federationSettingsPanel.mjs'
import { initProfileOwnerSettings } from './ownerSettingsPanel.mjs'
import { getProfile } from './src/endpoints.mjs'

let currentEntityHash = null
let currentProfile = null

/**
 * @param {HTMLElement | null} el 目标元素
 * @param {string} i18nKey data-i18n 键
 * @param {Record<string, string | number>} [params] dataset 插值
 * @returns {void}
 */
function applyDatasetI18n(el, i18nKey, params = {}) {
	if (!el) return
	el.dataset.i18n = i18nKey
	for (const k of Object.keys(el.dataset))
		if (k !== 'i18n') delete el.dataset[k]
	for (const [k, v] of Object.entries(params))
		el.dataset[k] = String(v)
	el.textContent = ''
}

/**
 * @param {HTMLElement | null} el 目标元素
 * @param {string} [text] 纯文本；空时用 `emptyI18nKey`
 * @param {string} [emptyI18nKey] 无文本时的 i18n 键
 * @returns {void}
 */
function setElTextOrI18n(el, text, emptyI18nKey) {
	if (!el) return
	if (text) {
		delete el.dataset.i18n
		el.textContent = text
	}
	else applyDatasetI18n(el, emptyI18nKey)
}

/**
 * @param {string} type 频道类型
 * @returns {string} `profile.channelType*` i18n 键
 */
function channelTypeI18nKey(type) {
	if (type === 'text') return 'profile.channelTypeText'
	if (type === 'list') return 'profile.channelTypeList'
	if (type === 'streaming') return 'profile.channelTypeStreaming'
	return 'profile.channelTypeVoice'
}

/**
 * @param {string} type 频道类型
 * @returns {string} Iconify `<img>` HTML
 */
function channelTypeIconHtml(type) {
	if (type === 'list')
		return '<img src="https://api.iconify.design/mdi/format-list-bulleted.svg" class="w-5 h-5" alt="" aria-hidden="true" />'
	if (type === 'voice' || type === 'streaming')
		return '<img src="https://api.iconify.design/mdi/volume-high.svg" class="w-5 h-5" alt="" aria-hidden="true" />'
	return '<img src="https://api.iconify.design/mdi/pound.svg" class="w-5 h-5" alt="" aria-hidden="true" />'
}

/**
 * 初始化个人资料页面
 */
async function init() {
	usingTemplates('/parts/shells:chat/src/templates')
	applyTheme()
	await initTranslations('profile')

	onLanguageChange(async () => {
		if (currentProfile) await renderProfile(currentProfile)
		await loadUserGroups()
		await loadUserChannels()
	})

	try {
		const resp = await fetch('/api/parts/shells:chat/viewer', { credentials: 'include' })
		if (!resp.ok) throw new Error(`viewer ${resp.status}`)
		const data = await resp.json()
		if (!data.viewerEntityHash) {
			showToastI18n(
				'error',
				data.identityRequired ? 'profile.errors.identityRequired' : 'profile.errors.invalidUserData',
			)
			return
		}
		currentEntityHash = data.viewerEntityHash
		await loadProfile(currentEntityHash)
	}
	catch (error) {
		console.error('Failed to get current user:', error)
		showToastI18n('error', 'profile.errors.fetchUserFailed')
	}

	document.getElementById('profile-edit-button')?.addEventListener('click', () => {
		if (!currentEntityHash) return
		void openHubProfileEdit(currentEntityHash, {
			/**
			 * 资料保存后重新加载当前用户资料页。
			 * @returns {Promise<void>}
			 */
			onSaved: async () => {
				await loadProfile(currentEntityHash)
			},
		})
	})

	await initProfileOwnerSettings()
	await initProfileFederationSettings()
	await loadUserGroups()
	await loadUserChannels()
}

/**
 * 加载用户资料
 * @param {string} entityHash - 128 位 entityHash
 */
async function loadProfile(entityHash) {
	try {
		const response = await getProfile(entityHash)
		if (response.profile) {
			currentProfile = response.profile
			await renderProfile(currentProfile)
		}
	}
	catch (error) {
		console.error('Failed to load profile:', error)
		showToastI18n('error', 'profile.errors.loadFailed')
	}
}

/**
 * 渲染用户资料
 * @param {object} profile - 用户资料
 */
async function renderProfile(profile) {
	const avatar = document.getElementById('profile-avatar')
	if (profile.avatar)
		avatar.src = profile.avatar
	else
		avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&size=128`

	document.getElementById('profile-display-name').textContent = profile.name
	document.getElementById('profile-username').textContent = `@${profile.username || profile.entityHash?.slice(64, 72) || '?'}`
	setElTextOrI18n(
		document.getElementById('profile-bio'),
		profileDescriptionText(profile),
		'profile.bioEmpty',
	)

	const statusBadge = document.getElementById('profile-status-badge')
	const statusText = document.getElementById('profile-status')
	const customStatus = document.getElementById('profile-custom-status')
	const displayStatus = profile.effectiveStatus || profile.status || 'offline'

	statusBadge.className = 'badge gap-2'
	switch (displayStatus) {
		case 'online':
			statusBadge.classList.add('badge-success')
			break
		case 'away':
			statusBadge.classList.add('badge-warning')
			break
		case 'busy':
			statusBadge.classList.add('badge-error')
			break
		default:
			statusBadge.classList.add('badge-neutral')
			break
	}
	applyDatasetI18n(statusText, `profile.statusOptions.${displayStatus}`)
	customStatus.textContent = profile.customStatus || ''

	await renderProfileLinks(profile.links)

	document.getElementById('summary-username').textContent = `@${profile.username || '?'}`
	applyDatasetI18n(
		document.getElementById('summary-status'),
		`profile.statusOptions.${displayStatus}`,
	)
	document.getElementById('summary-links-count').textContent = String(
		Array.isArray(profile.links) ? profile.links.length : 0,
	)
}

/**
 * @param {Array<{ icon?: string, name?: string, url: string }>} links 链接列表
 */
async function renderProfileLinks(links) {
	const container = document.getElementById('social-links')
	await mountTemplate(container, 'profile/social_links_shell', {
		links: Array.isArray(links) ? links : [],
	})
}

/**
 * 加载用户的群组列表
 */
async function loadUserGroups() {
	try {
		const response = await fetch('/api/parts/shells:chat/groups', {
			credentials: 'include',
		})
		if (!response.ok) return
		const data = await response.json()
		if (!Array.isArray(data)) return

		const groups = data
		const container = document.getElementById('profile-groups')
		const noGroups = document.getElementById('no-groups')

		if (groups.length === 0) {
			if (noGroups) noGroups.style.display = 'block'
			return
		}

		if (noGroups) noGroups.style.display = 'none'
		container.replaceChildren()
		for (const group of groups) {
			const description = group.description ?? ''
			container.appendChild(await renderTemplate('profile/group_row', {
				groupId: group.groupId,
				defaultChannelId: group.defaultChannelId || 'default',
				initial: (group.name || 'G')[0].toUpperCase(),
				name: group.name || group.groupId,
				description: escapeHtml(description),
				descriptionI18nAttr: description ? '' : ' data-i18n="profile.groupDescriptionEmpty"',
				members: String(group.memberCount || 0),
				channels: String(group.channelCount || 0),
			}))
		}

	}
	catch (error) {
		console.error('Failed to load groups:', error)
	}
}

/**
 * 加载用户的频道列表（从已加入的群组中提取）
 */
async function loadUserChannels() {
	try {
		const response = await fetch('/api/parts/shells:chat/groups', {
			credentials: 'include',
		})
		if (!response.ok) return
		const data = await response.json()
		if (!Array.isArray(data)) return

		const groups = data
		const allChannels = []

		for (const group of groups)
			try {
				const stateRes = await fetch(`/api/parts/shells:chat/groups/${group.groupId}/state`, {
					credentials: 'include',
				})
				if (!stateRes.ok) continue
				const stateData = await stateRes.json()
				if (!stateData.meta?.channels) continue

				for (const [channelId, channel] of Object.entries(stateData.meta.channels))
					allChannels.push({
						channelId,
						name: channel.name || channelId,
						type: channel.type || 'text',
						isPrivate: channel.isPrivate || false,
						groupName: group.name || group.groupId,
						groupId: group.groupId,
						defaultChannelId: group.defaultChannelId,
					})
			}
			catch { /* skip group */ }


		const container = document.getElementById('profile-channels')
		const noChannels = document.getElementById('no-channels')

		if (allChannels.length === 0) {
			if (noChannels) noChannels.style.display = 'block'
			return
		}

		if (noChannels) noChannels.style.display = 'none'
		container.replaceChildren()
		for (const channel of allChannels)
			container.appendChild(await renderTemplate('profile/channel_row', {
				groupId: channel.groupId,
				channelId: channel.channelId,
				iconHtml: channelTypeIconHtml(channel.type),
				typeI18nKey: channelTypeI18nKey(channel.type),
				groupName: channel.groupName,
				privateSpan: channel.isPrivate ? '<span data-i18n="profile.channelPrivate"></span>' : '',
				name: channel.name,
			}))

	}
	catch (error) {
		console.error('Failed to load channels:', error)
	}
}

init()
