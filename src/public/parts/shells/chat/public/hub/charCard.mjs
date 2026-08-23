/**
 * 【文件】public/hub/charCard.mjs
 * 【职责】角色（char part）资料卡渲染：拉取角色详情、展示简介与进入私聊/编辑资料入口。
 * 【原理】`renderCharInfoCard` / `renderCharInfoCardActive` 填充主栏角色信息区；资料卡与悬停/弹层共用 `profile_popup` 全量渲染。
 * 【数据结构】store 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../../../../scripts/template、core/domUtils、core/state、entityProfile、entityResolve、presence
 */
import { getPartDetails } from '/scripts/endpoints/parts.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { createEntityProfileCardElement } from '../shared/entityProfileCard.mjs'
import { displayProfileAvatar } from '../shared/hashAvatar.mjs'
import { resolveViewerSidebarDisplayName } from '../shared/viewerDisplay.mjs'
import { mountTemplate } from '../src/templates.mjs'

import { applyProfileAvatarToHost } from './core/avatarCover.mjs'
import { avatarColor, avatarInitial, avatarTextColor } from './core/domUtils.mjs'
import { store } from './core/state.mjs'
import {
	loadEntityProfile,
	paintBioMarkdown,
	paintEntityProfileUi,
	profileDescriptionText,
	wireEntityProfileCardActions,
} from './entityProfile.mjs'
import { charAgentEntityHash } from './entityResolve.mjs'
import { applyAvatarsTo } from './presence.mjs'

/** 角色信息卡渲染世代：切换角色时递增，作废过期的异步重绘。 */
let charInfoCardRenderGeneration = 0

/**
 * 从 API 拉取角色详情。
 * @param {string} name - 角色 part 名称
 * @returns {Promise<object|null>} 详情 JSON，失败时为 null
 */
export async function getCharDetails(name) {
	try {
		return await getPartDetails(`chars/${name}`)
	}
	catch {
		return null
	}
}

/**
 * @param {string} name 角色名
 * @param {object|null} [details] 预取的角色详情
 * @param {{ active: boolean }} mode 是否已进入私聊
 * @returns {Promise<void>}
 */
async function renderCharInfoCardInner(name, details, { active }) {
	const generation = ++charInfoCardRenderGeneration
	const entityHash = await charAgentEntityHash(name)
	if (generation !== charInfoCardRenderGeneration) return
	const groupId = store.context.currentGroupId || undefined
	const profile = entityHash ? await loadEntityProfile(entityHash, { groupId }) : null
	if (generation !== charInfoCardRenderGeneration) return
	const info = details?.info || {}
	const charDisplayName = profile?.name || info.name || name
	const avatarUrl = displayProfileAvatar(profile)
	const { viewerDisplayName, viewerEntityHash } = store.viewer
	const currentState = store.context.currentState
	const viewerMember = (currentState?.members || [])
		.find(member => member.memberKey === currentState?.viewerMemberPubKeyHash)
	const myDisplayName = resolveViewerSidebarDisplayName({
		viewerDisplayName,
		entityHash: viewerEntityHash,
		memberDisplayName: viewerMember?.displayName,
		alias: aliasForEntity(viewerEntityHash),
	})
	const memberList = document.getElementById('member-list')
	const charName = escapeHtml(charDisplayName)
	if (generation !== charInfoCardRenderGeneration) return
	const charAvatarSeed = entityHash || name
	const sidebarTpl = active ? 'hub/char/member_sidebar_active' : 'hub/char/member_sidebar_preview'

	await mountTemplate(memberList, sidebarTpl, {
		charName,
		charAvatarHtml: '',
		avatarBg: avatarColor(charAvatarSeed),
		avatarTextColor: avatarTextColor(charAvatarSeed),
		viewerDisplayName: escapeHtml(myDisplayName),
		viewerEntityHash: viewerEntityHash ? escapeHtml(viewerEntityHash) : '',
		myAvatarBg: viewerEntityHash ? avatarColor(viewerEntityHash) : '',
		myAvatarTextColor: viewerEntityHash ? avatarTextColor(viewerEntityHash) : '',
		myAvatarInitial: escapeHtml(avatarInitial(myDisplayName)),
	})
	if (generation !== charInfoCardRenderGeneration) return

	// 角色头像走共用渲染（URL 图 / 表情文本 / hash 字母），与消息·成员·资料卡一致，
	// 不在此重写「URL or 表情」判定。
	const charAvatarHost = memberList.querySelector('.member-item-char .member-avatar')
	if (charAvatarHost instanceof HTMLElement)
		applyProfileAvatarToHost(charAvatarHost, {
			seed: charAvatarSeed,
			label: charDisplayName,
			avatar: avatarUrl,
		})

	const descriptionElement = memberList.querySelector('.char-description-md')
	if (descriptionElement instanceof HTMLElement)
		await paintBioMarkdown(
			descriptionElement,
			profile
				? profileDescriptionText(profile)
				: info.description_markdown || info.description || info.summary || details?.description || '',
			entityHash || '',
		)
	if (generation !== charInfoCardRenderGeneration) return

	const infoCardHost = document.getElementById('info-card-host')
	infoCardHost.replaceChildren()
	const card = await createEntityProfileCardElement('sidebar')
	if (generation !== charInfoCardRenderGeneration) return
	infoCardHost.appendChild(card)

	const entity = {
		entityHash,
		charname: name,
		pubKeyHex: null,
		pubKeyHash: null,
		displayName: charDisplayName,
	}

	if (profile)
		await paintEntityProfileUi(card, profile)
	else {
		const nameElement = card.querySelector('[data-entity-profile-name]')
		if (nameElement) nameElement.textContent = charDisplayName
	}
	if (generation !== charInfoCardRenderGeneration) return

	if (entityHash) {
		/** 角色信息卡内容变更后重绘。 */
		const repaint = async () => {
			if (generation !== charInfoCardRenderGeneration) return
			const details = await getCharDetails(name)
			if (generation !== charInfoCardRenderGeneration) return
			await renderCharInfoCardInner(name, details, { active })
		}
		await wireEntityProfileCardActions(card, entity, {
			profile,
			onRepaint: repaint,
		})
	}
	if (generation !== charInfoCardRenderGeneration) return

	if (active)
		applyAvatarsTo(memberList)
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
