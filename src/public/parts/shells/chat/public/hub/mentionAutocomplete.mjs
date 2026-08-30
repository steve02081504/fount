/**
 * Hub composer @ 提及薄封装：共享组件 + 群内成员 provider + 无群（DM）上下文的本地候选回落。
 */
import { attachMentionAutocomplete, insertTokenIntoComposer } from '/scripts/components/mentionAutocomplete.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { getRegisteredMentionSuggest } from '/scripts/features/markdown/extensions.mjs'
import { escapeRegExp } from '/scripts/lib/regex.mjs'

import { isEntityHash128 } from '../shared/entityHash.mjs'
import { formatEntityMentionToken } from '../shared/inlineTokenSyntax.mjs'
import { suggestMentions } from '../src/endpoints/mentions.mjs'

import { store } from './core/state.mjs'
import { charAgentEntityHash } from './entityResolve.mjs'
import { loadFriendsList } from './friendsList.mjs'

/**
 * 群内成员/角色 @ 候选（有群上下文时生效；空群返回 [] 保持群内空态语义）。
 * @param {{ groupId?: string, channelId?: string, channelIds?: string[] }} ctx 上下文
 * @param {string} query 过滤词
 * @param {number} limit 条数上限
 * @returns {Promise<object[] | null>} 候选；无群上下文返回 null
 */
async function chatGroupProvider(ctx, query, limit) {
	if (!ctx.groupId) return null
	const data = await suggestMentions(ctx.groupId, query, limit)
	return data.suggestions ?? []
}

/**
 * 无群上下文（DM/好友模式）时的本地候选：好友会话对端 + 本地角色。
 * @param {{ groupId?: string, channelId?: string, channelIds?: string[] }} ctx 上下文
 * @param {string} query 过滤词
 * @param {number} limit 条数上限
 * @returns {Promise<object[]>} 候选（永不返回 null）
 */
async function globalFallbackProvider(ctx, query, limit) {
	if (ctx.groupId) return null
	const friends = await loadFriendsList()
	const re = query ? new RegExp(escapeRegExp(query), 'i') : null
	const rows = []
	const seen = new Set()
	for (const friend of friends) {
		let entityHash = ''
		if (isEntityHash128(friend.key)) entityHash = friend.key
		else if (friend.charname) entityHash = friend.key || await charAgentEntityHash(friend.charname)
		if (!isEntityHash128(entityHash) || seen.has(entityHash)) continue
		const displayName = friend.displayName || ''
		const handle = friend.charname || ''
		if (re && !re.test(displayName) && !re.test(handle)) continue
		seen.add(entityHash)
		rows.push({ kind: 'entity', entityHash, displayName, handle })
		if (rows.length >= limit) break
	}
	return rows
}

/**
 * 当前 Hub 群/频道上下文。
 * @returns {{ groupId?: string, channelId?: string, channelIds?: string[] }} 上下文
 */
function hubMentionContext() {
	const { currentGroupId, currentChannelId, currentState } = store.context
	return {
		groupId: currentGroupId,
		channelId: currentChannelId,
		channelIds: Object.keys(currentState?.channels ?? {}),
	}
}

/**
 * 为 Hub composer 挂载 @ 提及 autocomplete。
 * @param {HTMLTextAreaElement} textarea 消息输入框
 * @returns {() => void} 卸载监听
 */
export function attachHubMentionAutocomplete(textarea) {
	return attachMentionAutocomplete(textarea, {
		getContext: hubMentionContext,
		providers: [
			...getRegisteredMentionSuggest(),
			chatGroupProvider,
			globalFallbackProvider,
		],
		listboxPrefix: 'hub-mention',
		emptyI18n: 'chat.hub.mentionEmpty',
		accessibleLabelI18n: 'chat.hub.mentionSuggest',
		trailingSpace: true,
		onError: handleError('chat.hub.operationFailed'),
	})
}

/**
 * 向 composer 插入 @entityHash。
 * @param {string} entityHash 128 hex
 * @returns {void}
 */
export function insertComposerMention(entityHash) {
	const textarea = /** @type {HTMLTextAreaElement | null} */ document.getElementById('message-input')
	if (!textarea || textarea.disabled) return
	if (!entityHash) return
	insertTokenIntoComposer(textarea, formatEntityMentionToken(entityHash), { trailingSpace: true })
}
