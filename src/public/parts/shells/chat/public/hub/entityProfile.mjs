/**
 * 【文件】public/hub/entityProfile.mjs
 * 【职责】实体（用户/角色）资料数据到 Hub UI 的绘制：简介 Markdown、资料卡操作按钮绑定。
 * 【原理】`paintEntityProfileUi`、`paintBioMarkdown`、`wireEntityProfileCardActions` 更新资料卡 DOM。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../src/endpoints/entities、core/state、entityResolve、presence、profileEdit。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { promptText } from '../../../../scripts/features/promptDialog.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { i18nElement } from '../../../../scripts/i18n/index.mjs'
import { aliasForEntity, setEntityAlias } from '../shared/aliases.mjs'
import { isCared, setCared } from '../shared/care.mjs'
import { isEntityHash128 } from '../shared/entityHash.mjs'
import {
	paintEntityProfileBio,
	paintEntityProfileCard,
	paintEntityProfileExtras,
	profileDescriptionText as sharedProfileDescriptionText,
} from '../shared/entityProfileCard.mjs'
import { formatSocialProfileHref } from '/parts/shells:social/shared/runUri.mjs'
import { cachedProfileFromApi, getEntityProfile } from '../src/endpoints/entities.mjs'
import { showTrustAuthorDialog } from '../src/trustAuthorDialog.mjs'
import { isTrustedAuthor } from '../src/trustedAuthors.mjs'

import { refreshAliasDependentUi } from './aliasUi.mjs'
import { store } from './core/state.mjs'
import { canEditEntityProfile, isViewerEntityHash } from './entityResolve.mjs'
import { dispatchFriendChat } from './friendChat.mjs'
import {
	fetchUserProfile,
} from './presence.mjs'
import { openHubProfileEdit } from './profileEdit.mjs'

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
	const data = await getEntityProfile(entityHash, options.groupId || store.context.currentGroupId)
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
	await paintEntityProfileCard(root, profile, {
		entityHash: avatarSeed,
		selfEntityHash: store.viewer?.viewerEntityHash,
		nodeHash: store.viewer?.nodeHash,
		viewerOwnerEntityHash: store.viewer?.ownerEntityHash,
	})

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
 * @param {string} bio 简介 markdown 源
 * @param {string} [entityHash] 作者 hash（信任判定）
 * @returns {Promise<void>}
 */
export async function paintBioMarkdown(descriptionElement, bio, entityHash = '') {
	await paintEntityProfileBio(descriptionElement, bio, entityHash, {
		emptyI18n: 'chat.hub.char.descriptionEmpty',
		selfEntityHash: store.viewer?.viewerEntityHash,
		nodeHash: store.viewer?.nodeHash,
		viewerOwnerEntityHash: store.viewer?.ownerEntityHash,
	})
	if (descriptionElement instanceof HTMLElement && bio.trim())
		descriptionElement.classList.add('char-description-md')
}

/**
 * 绑定「编辑资料」按钮。
 * @param {HTMLElement} root 根节点
 * @param {string} entityHash 128 位 entityHash
 * @param {{ onSaved?: () => void | Promise<void>, profile?: object | null }} [options] 保存后；profile 用于主人判定
 * @returns {void}
 */
export function wireProfileEditButton(root, entityHash, options = {}) {
	const editButton = root?.querySelector('[data-entity-profile-edit], [data-profile-popup-edit]')
	if (!(editButton instanceof HTMLButtonElement)) return
	const canEdit = canEditEntityProfile(entityHash, options.profile)
	editButton.hidden = !canEdit
	/**
	 * 打开 Hub 资料编辑对话框。
	 * @returns {void}
	 */
	editButton.onclick = () => {
		void openHubProfileEdit(entityHash, { onSaved: options.onSaved })
	}
}

/**
 * 将候选值规范为小写 64 hex；无效则返回空串。
 * @param {unknown} value 候选 hex
 * @returns {string} 小写 64 hex；无效为空串
 */
function normHex(value) {
	const normalized = String(value ?? '')
	return isHex64(normalized) ? normalized : ''
}

/**
 * 解析信任作者用的成员 pubKeyHash（64 hex）。
 * @param {object} entity 实体
 * @param {object | null} profile 资料
 * @returns {string} 小写 64 hex；无法解析为空串
 */
function resolveTrustAuthorPubKeyHash(entity, profile) {
	const direct = normHex(entity?.pubKeyHash)
	if (direct) return direct
	const entityHash = entity?.entityHash || ''
	for (const member of store.context.currentState?.members || []) {
		const memberHash = member?.entityHash || ''
		const memberKey = normHex(member?.pubKeyHash || member?.memberKey)
		if (entityHash && memberHash === entityHash && memberKey) return memberKey
	}
	return normHex(profile?.activePubKeyHex)
}

/**
 * 信任作者后刷新当前频道中该作者消息的 Markdown 与「已信任」徽章。
 * @param {string} authorPubKeyHash 作者成员键
 * @returns {Promise<void>}
 */
async function refreshTrustedAuthorMessages(authorPubKeyHash) {
	if (!isHex64(authorPubKeyHash)) return
	const container = document.getElementById('messages')
	if (!(container instanceof HTMLElement)) return
	const { hydrateMessageMarkdown } = await import('./messages/render/markdown.mjs')
	const { renderTemplateAsHtmlString } = await import('../../../../scripts/features/template.mjs')
	const badgeHtml = await renderTemplateAsHtmlString('hub/messages/trusted_author_badge', {})
	for (const row of container.querySelectorAll(`.message[data-author-pubkey-hash="${authorPubKeyHash}"]`)) {
		if (!(row instanceof HTMLElement)) continue
		const messageId = row.getAttribute('data-message-id')
		if (messageId) await hydrateMessageMarkdown(container, messageId)
		const header = row.querySelector('.message-author')?.parentElement
		if (!(header instanceof HTMLElement)) continue
		if (header.querySelector('.trusted-author-badge')) continue
		const remote = header.querySelector('.remote-badge')
		if (remote) remote.insertAdjacentHTML('afterend', badgeHtml)
		else header.querySelector('.message-author')?.insertAdjacentHTML('afterend', badgeHtml)
		i18nElement(header, { skip_report: true })
	}
}

/**
 * 绑定资料卡全套操作按钮（编辑 / 私聊 / Social / 信任 / 别名 / 关心）。
 * @param {HTMLElement} root 人物卡根节点
 * @param {object} entity 实体（含 `entityHash`）
 * @param {{
 *   profile?: object | null,
 *   onSaved?: () => void | Promise<void>,
 *   onRepaint?: () => void | Promise<void>,
 *   onBeforeDm?: () => void,
 * }} [options] 保存后 / 重绘 / 私聊前回调
 * @returns {Promise<void>}
 */
export async function wireEntityProfileCardActions(root, entity, options = {}) {
	if (!(root instanceof HTMLElement) || !entity) return
	const entityHash = entity.entityHash || ''
	const profile = options.profile ?? null
	const isSelf = isViewerEntityHash(entityHash)

	const alias = entityHash ? aliasForEntity(entityHash) : ''
	if (alias) {
		const nameElement = root.querySelector('[data-entity-profile-name]')
		if (nameElement) nameElement.textContent = alias
	}

	if (entityHash)
		wireProfileEditButton(root, entityHash, {
			profile,
			/** 资料保存后刷新资料卡。 */
			onSaved: async () => {
				await options.onSaved?.()
				await options.onRepaint?.()
			},
		})

	const dmButton = root.querySelector('[data-profile-popup-dm]')
	if (dmButton instanceof HTMLButtonElement) {
		const pubKeyHex = normHex(entity.pubKeyHex || profile?.activePubKeyHex)
		// Social「私信」只带 entityHash；有实体即可露出按钮，点下再解析活跃公钥
		const canDm = !isSelf && (entity.charname || pubKeyHex || isEntityHash128(entityHash))
		dmButton.hidden = !canDm
		dmButton.dataset.i18n = entity.charname
			? 'chat.hub.profilePopup.dm.char'
			: 'chat.hub.profilePopup.dm.user'
		/** 点击发起私聊。 */
		dmButton.onclick = () => {
			options.onBeforeDm?.()
			void (async () => {
				if (entity.charname) {
					await dispatchFriendChat({
						type: 'char',
						id: entity.charname,
						displayName: entity.displayName,
						entityHash,
					})
					return
				}
				await dispatchFriendChat({
					type: 'user',
					displayName: entity.displayName || profile?.name,
					pubKeyHex: pubKeyHex || null,
					entityHash,
				})
			})().catch(error => {
				showToastI18n('error', 'chat.hub.profilePopup.dm.failed', { error: error.message })
			})
		}
	}

	const socialButton = root.querySelector('[data-profile-popup-social]')
	if (socialButton instanceof HTMLButtonElement) {
		socialButton.hidden = !isEntityHash128(entityHash)
		/** 跳转社交主页。 */
		socialButton.onclick = () => {
			if (!isEntityHash128(entityHash)) return
			window.location.href = formatSocialProfileHref(entityHash)
		}
	}

	const trustButton = root.querySelector('[data-profile-popup-trust]')
	if (trustButton instanceof HTMLButtonElement) {
		const authorPubKeyHash = resolveTrustAuthorPubKeyHash(entity, profile)
		const alreadyTrusted = authorPubKeyHash ? await isTrustedAuthor(authorPubKeyHash) : false
		const canTrust = !isSelf && !entity.charname && authorPubKeyHash && !alreadyTrusted
		trustButton.hidden = !canTrust
		if (canTrust) {
			trustButton.dataset.authorPubKeyHash = authorPubKeyHash
			/** 打开信任作者对话框。 */
			trustButton.onclick = () => {
				void (async () => {
					const name = root.querySelector('[data-entity-profile-name]')?.textContent?.trim()
						|| entity.displayName
						|| profile?.name
						|| ''
					const trusted = await showTrustAuthorDialog(authorPubKeyHash, name)
					if (!trusted) return
					showToastI18n('success', 'chat.hub.trustOk')
					trustButton.hidden = true
					await refreshTrustedAuthorMessages(authorPubKeyHash)
					await options.onRepaint?.()
				})().catch(error => {
					showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
				})
			}
		}
	}

	const aliasButton = root.querySelector('[data-profile-popup-alias]')
	if (aliasButton instanceof HTMLButtonElement) {
		aliasButton.hidden = !isEntityHash128(entityHash)
		/** 设置实体别名。 */
		aliasButton.onclick = () => {
			void (async () => {
				const current = root.querySelector('[data-entity-profile-name]')?.textContent?.trim() || ''
				const next = await promptText(
					'chat.hub.profilePopup.setAliasPrompt',
					aliasForEntity(entityHash),
					{ name: current },
				)
				if (next == null) return
				await setEntityAlias(entityHash, next)
				showToastI18n('success', 'chat.hub.member.context.aliasSaved')
				await options.onRepaint?.()
				await refreshAliasDependentUi()
			})().catch(error => {
				showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
			})
		}
	}

	const careButton = root.querySelector('[data-profile-popup-care]')
	if (careButton instanceof HTMLButtonElement) {
		const canCare = !isSelf && isEntityHash128(entityHash) && !!store.viewer?.operatorEntityHash
		careButton.hidden = !canCare
		if (canCare) {
			let cared = await isCared(entityHash)
			careButton.dataset.i18n = cared
				? 'chat.hub.profilePopup.careRemove'
				: 'chat.hub.profilePopup.care'
			/** 切换关心状态。 */
			careButton.onclick = () => {
				void (async () => {
					const next = !cared
					await setCared(entityHash, next)
					cared = next
					showToastI18n('success', next ? 'chat.hub.member.context.careAdded' : 'chat.hub.member.context.careRemoved')
					careButton.dataset.i18n = next
						? 'chat.hub.profilePopup.careRemove'
						: 'chat.hub.profilePopup.care'
				})().catch(error => {
					showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
				})
			}
		}
	}
}
