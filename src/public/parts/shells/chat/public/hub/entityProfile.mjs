/**
 * 【文件】public/hub/entityProfile.mjs
 * 【职责】实体（用户/角色）资料数据到 Hub UI 的绘制：标签、简介 Markdown、编辑按钮绑定。
 * 【原理】`paintEntityProfileUi`、`paintBioMarkdown`、`wireProfileEditButton` 更新资料卡 DOM。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/markdown、../src/entityProfileApi、core/avatarCover、core/domUtils、core/state、entityResolve、presence、profileEdit。
 */
import { renderMarkdown } from '../../../../scripts/features/markdown/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { isEntityHash128 } from '../shared/entityHash.mjs'
import {
	paintEntityProfileCard,
	paintEntityProfileExtras,
	profileDescriptionText as sharedProfileDescriptionText,
} from '../shared/entityProfileCard.mjs'
import { fetchEntityProfileApi, cachedProfileFromApi } from '../src/entityProfileApi.mjs'

import { hubStore } from './core/state.mjs'
import { isLocalWritableEntityHash } from './entityResolve.mjs'
import {
	fetchUserProfile,
	invalidateUserProfileCache,
} from './presence.mjs'
import { openHubProfileEdit } from './profileEdit.mjs'

/**
 * @param {string[]} tags 标签
 * @returns {string} HTML
 */
export function renderProfileTagsHtml(tags) {
	const list = Array.isArray(tags) ? tags.filter(Boolean) : []
	if (!list.length) return ''
	return list.map(t =>
		`<span class="hub-profile-tag badge badge-outline badge-sm">${escapeHtml(t)}</span>`,
	).join('')
}

/**
 * @param {HTMLElement|null} host 容器
 * @param {string[]} tags 标签
 * @returns {void}
 */
export function paintProfileTags(host, tags) {
	if (!host) return
	const html = renderProfileTagsHtml(tags)
	if (!html) {
		host.replaceChildren()
		host.hidden = true
		return
	}
	host.hidden = false
	host.innerHTML = html
}

/**
 * @param {object} profile API profile
 * @returns {string} 用于展示的简介文本
 */
export function profileDescriptionText(profile) {
	return sharedProfileDescriptionText(profile)
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {{ bypassCache?: boolean, groupId?: string }} [options] 选项
 * @returns {Promise<object|null>} 解析后的 profile 或 null
 */
export async function loadEntityProfile(entityHash, options = {}) {
	if (!options.bypassCache) {
		const cached = await fetchUserProfile(entityHash, { groupId: options.groupId })
		if (cached) return cached
	}
	const data = await fetchEntityProfileApi(entityHash, options.groupId || hubStore.context.currentGroupId)
	if (!data?.profile) return null
	return cachedProfileFromApi(data.profile, entityHash)
}

/**
 * @param {HTMLElement} root 根节点（含 data 属性选择器字段）
 * @param {object} profile 资料
 * @param {{ attribution?: object | null }} [extras] 附加：归因警告等
 * @returns {Promise<void>}
 */
export async function paintEntityProfileUi(root, profile, extras = {}) {
	if (!root || !profile) return
	const avatarSeed = root.dataset?.entityHash || root.dataset?.entityProfileHash || profile.entityHash || profile.name
	await paintEntityProfileCard(root, profile, { entityHash: avatarSeed })

	const ownerEntityHash = profile.ownerEntityHash || null
	let ownerName = null
	if (isEntityHash128(ownerEntityHash)) {
		ownerName = aliasForEntity(ownerEntityHash)
		if (!ownerName)
			try {
				const ownerProfile = await loadEntityProfile(ownerEntityHash)
				ownerName = ownerProfile?.name || null
			}
			catch { /* remote miss */ }
	}
	paintEntityProfileExtras(root, {
		ownerEntityHash,
		ownerName,
		attribution: extras.attribution || null,
	})
}

/**
 * @param {HTMLElement} descriptionElement Markdown 容器
 * @param {string} bio 简介
 * @returns {Promise<void>}
 */
export async function paintBioMarkdown(descriptionElement, bio) {
	if (!(descriptionElement instanceof HTMLElement)) return
	const text = String(bio || '').trim()
	if (!text) {
		descriptionElement.replaceChildren()
		descriptionElement.dataset.i18n = 'chat.hub.charDescriptionEmpty'
		return
	}
	delete descriptionElement.dataset.i18n
	descriptionElement.className = 'hub-char-description-md markdown-body'
	descriptionElement.replaceChildren(await renderMarkdown(text))
}

/**
 * 绑定「编辑资料」按钮。
 * @param {HTMLElement} root 根节点
 * @param {string} entityHash 128 位 entityHash
 * @param {{ onSaved?: () => void | Promise<void> }} [options] 保存后
 * @returns {void}
 */
export function wireProfileEditButton(root, entityHash, options = {}) {
	const editButton = root?.querySelector('[data-entity-profile-edit], [data-profile-popup-edit]')
	if (!(editButton instanceof HTMLButtonElement)) return
	const canEdit = isLocalWritableEntityHash(entityHash)
	editButton.hidden = !canEdit
	/**
	 * 打开 Hub 资料编辑对话框。
	 * @returns {void}
	 */
	editButton.onclick = () => {
		void openHubProfileEdit(entityHash, {
			/**
			 * 保存后失效缓存并调用外部刷新回调。
			 * @returns {Promise<void>}
			 */
			onSaved: async () => {
				invalidateUserProfileCache(entityHash)
				await options.onSaved?.()
			},
		})
	}
}
