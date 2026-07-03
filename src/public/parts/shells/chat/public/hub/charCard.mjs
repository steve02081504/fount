/**
 * 【文件】public/hub/charCard.mjs
 * 【职责】角色（char part）资料卡渲染：拉取角色详情、展示简介与进入私聊/编辑资料入口。
 * 【原理】`renderCharInfoCard` / `renderCharInfoCardActive` 填充主栏角色信息区模板。
 * 【数据结构】hubStore 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../../../../scripts/template、core/domUtils、core/state、entityProfile、entityResolve
 */
import {
	mountTemplate,
	renderTemplateAsHtmlString,
	usingTemplates,
} from '../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { avatarColor, avatarInitial } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import {
	loadEntityProfile,
	paintBioMarkdown,
	paintEntityProfileUi,
	profileDescriptionText,
	wireProfileEditButton,
} from './entityProfile.mjs'
import { charAgentEntityHash } from './entityResolve.mjs'

/** @type {() => void} */
let applyAvatarsToRef = () => { }
/** @type {() => string|null} */
let getViewerDisplayNameRef = () => null
/** @type {(name: string) => void} */
let onEnterPrivateGroupRef = () => { }

/**
 * 注入角色卡 UI 所需的 Hub 回调。
 * @param {object} callbacks - 回调集合
 * @param {() => void} callbacks.applyAvatarsTo - 将头像应用到成员列表 DOM
 * @param {() => string|null} callbacks.getViewerDisplayName - 当前 viewer 展示名
 * @param {(name: string) => void} callbacks.onEnterPrivateGroup - 用户点击开始聊天
 * @returns {void}
 */
export function initCharCard({ applyAvatarsTo, getViewerDisplayName, onEnterPrivateGroup }) {
	applyAvatarsToRef = applyAvatarsTo
	getViewerDisplayNameRef = getViewerDisplayName
	onEnterPrivateGroupRef = onEnterPrivateGroup
}

/**
 * 从 API 拉取角色详情。
 * @param {string} name - 角色 part 名称
 * @returns {Promise<object|null>} 详情 JSON，失败时为 null
 */
export async function getCharDetails(name) {
	try {
		const resp = await fetch(`/api/getdetails/chars/${encodeURIComponent(name)}`, { credentials: 'include' })
		if (!resp.ok) return null
		return await resp.json()
	}
	catch {
		return null
	}
}

/**
 * 生成成员头像 HTML（图片或首字母）。
 * @param {string} name - 角色名
 * @param {string} avatarUrl - 头像 URL，空则显示首字母
 * @returns {string} 头像区域 HTML
 */
async function charAvatarHtml(name, avatarUrl) {
	return avatarUrl
		? renderTemplateAsHtmlString('hub/chat/entry_avatar_img', { src: escapeHtml(avatarUrl), alt: escapeHtml(name) })
		: escapeHtml(avatarInitial(name))
}

/**
 * @param {string} name 角色名
 * @param {object|null} [details] 预取的角色详情
 * @param {{ active: boolean }} mode 是否已进入私聊
 * @returns {Promise<void>}
 */
async function renderCharInfoCardInner(name, details, { active }) {
	usingTemplates('/parts/shells:chat/src/templates')
	const entityHash = await charAgentEntityHash(name)
	const groupId = hubStore.context.currentGroupId || undefined
	const profile = entityHash ? await loadEntityProfile(entityHash, { groupId }) : null
	const info = details?.info || {}
	const charDisplayName = profile?.name || info.name || name
	const avatarUrl = profile?.avatar || info.avatar || details?.avatar || ''
	const viewerDisplayName = getViewerDisplayNameRef()
	const { viewerEntityHash } = hubStore
	const memberList = document.getElementById('hub-member-list')
	const charName = escapeHtml(charDisplayName)
	const charAvatarInner = await charAvatarHtml(charDisplayName, avatarUrl)
	const sidebarTpl = active ? 'hub/char/member_sidebar_active' : 'hub/char/member_sidebar_preview'

	await mountTemplate(memberList, sidebarTpl, {
		charName,
		charAvatarHtml: charAvatarInner,
		avatarBg: avatarColor(charDisplayName),
		viewerDisplayName: viewerDisplayName ? escapeHtml(viewerDisplayName) : '',
		viewerEntityHash: viewerEntityHash ? escapeHtml(viewerEntityHash) : '',
		myAvatarBg: viewerDisplayName ? avatarColor(viewerDisplayName) : '',
		myAvatarInitial: viewerDisplayName ? escapeHtml(avatarInitial(viewerDisplayName)) : '',
	})

	const descriptionElement = memberList.querySelector('.hub-char-description-md')
	if (descriptionElement instanceof HTMLElement)
		await paintBioMarkdown(descriptionElement, profile
			? profileDescriptionText(profile)
			: info.description_markdown || info.description || info.summary || details?.description || '')

	const infoCardHost = document.getElementById('hub-info-card-host')
	const infoTpl = active ? 'hub/char/info_card_active' : 'hub/char/info_card_preview'
	await mountTemplate(infoCardHost, infoTpl, {
		charName,
		charNameRaw: escapeHtml(name),
		entityHash: escapeHtml(entityHash || ''),
		charAvatarHtml: charAvatarInner,
		avatarBg: avatarColor(charDisplayName),
		descriptionPreview: '',
	})

	const card = infoCardHost?.querySelector('.hub-info-card')
	if (card instanceof HTMLElement && profile) {
		await paintEntityProfileUi(card, profile)
		await paintBioMarkdown(card.querySelector('[data-entity-profile-bio]'), profileDescriptionText(profile))
		if (entityHash)
			wireProfileEditButton(card, entityHash, {
				/**
				 * 资料保存后重绘角色信息卡。
				 * @returns {Promise<void>}
				 */
				onSaved: async () => {
					await renderCharInfoCardInner(name, await getCharDetails(name), { active })
				},
			})
	}

	if (active)
		applyAvatarsToRef(memberList)
	else
		infoCardHost?.querySelector('.hub-info-cta')?.addEventListener('click', () => onEnterPrivateGroupRef(name))
}

/**
 * 渲染已进入私聊的角色信息卡（含参与者列表）。
 * @param {string} name - 角色名
 * @param {object|null} [details] - 预取的角色详情，可省略字段
 * @returns {Promise<void>}
 */
export async function renderCharInfoCardActive(name, details) {
	return renderCharInfoCardInner(name, details, { active: true })
}

/**
 * 渲染角色预览信息卡（含「开始聊天」按钮）。
 * @param {string} name - 角色名
 * @param {object|null} [details] - 预取的角色详情，可省略字段
 * @returns {Promise<void>}
 */
export async function renderCharInfoCard(name, details) {
	return renderCharInfoCardInner(name, details, { active: false })
}
