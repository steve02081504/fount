/**
 * 【文件】master.mjs
 * 【职责】解析 agent 声明主人（identity.ownerEntityHash），以及消息是否来自可信主人。
 * 【原理】主人取被管实体自签的所属字段；可信判定要求密码学作者匹配且 attribution 可信。
 * 【关联】identity.loadEntityIdentity、attribution、gentian_shell_contract / GentianAphrodite。
 */
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { deriveMessageAttribution, isTrustedOwnerAttribution } from '../chat/lib/attribution.mjs'

import { loadEntityIdentity } from './identity.mjs'
import { memberEntityHash } from './member.mjs'


/**
 * 读取实体声明的主人 entityHash。
 * @param {string} username replica
 * @param {string} entityHash 被管实体
 * @returns {Promise<string | null>} 主人 hash；无则 null
 */
export async function resolveDeclaredOwnerEntityHash(username, entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(hash)) return null
	const row = await loadEntityIdentity(username, hash)
	const owner = row?.ownerEntityHash ? String(row.ownerEntityHash).toLowerCase() : null
	return owner && isEntityHash128(owner) ? owner : null
}

/**
 * 从 OnMessage / Message 行解析密码学作者实体。
 * @param {object} eventOrLine OnMessage 事件或消息行
 * @param {object} [state] 可选物化状态（含 members）
 * @returns {string | null} 作者 entityHash
 */
export function resolveCryptographicAuthorEntityHash(eventOrLine, state = null) {
	const message = eventOrLine?.message || eventOrLine
	const content = message?.content && typeof message.content === 'object' ? message.content : {}
	const bridge = message?.extension?.bridge
		|| content.extension?.bridge
		|| eventOrLine?.chatReplyRequest?.extension?.bridge
	if (bridge?.authorEntityHash && isEntityHash128(String(bridge.authorEntityHash)))
		return String(bridge.authorEntityHash).toLowerCase()

	const sender = String(message?.sender || eventOrLine?.sender || '').trim().toLowerCase()
	if (state?.members && sender) {
		const member = state.members[sender]
		const hash = memberEntityHash(member)
		if (hash) return hash
		if (message?.charId) {
			const agentKey = Object.keys(state.members).find(key => {
				const row = state.members[key]
				return row?.memberKind === 'agent' && row.charname === message.charId && row.status === 'active'
			})
			if (agentKey) {
				const agentHash = memberEntityHash(state.members[agentKey])
				if (agentHash) return agentHash
			}
		}
	}
	return null
}

/**
 * 判定消息是否来自 agent 声明的可信主人。
 * @param {object} options 选项
 * @param {string} options.username replica
 * @param {string} options.agentEntityHash agent 自身 hash
 * @param {object} options.eventOrLine OnMessage 事件或消息行
 * @param {object} [options.state] 物化状态
 * @param {string | null} [options.authorEntityHash] 已解析的作者 hash
 * @returns {Promise<{ declaredOwnerEntityHash: string | null, authorEntityHash: string | null, attribution: object, isFromOwner: boolean }>} 结果
 */
export async function resolveTrustedOwnerContext({
	username,
	agentEntityHash,
	eventOrLine,
	state = null,
	authorEntityHash = null,
}) {
	const declaredOwnerEntityHash = await resolveDeclaredOwnerEntityHash(username, agentEntityHash)
	const message = eventOrLine?.message || eventOrLine
	const content = message?.content && typeof message.content === 'object' ? message.content : {}
	const signerEntityHash = authorEntityHash || resolveCryptographicAuthorEntityHash(eventOrLine, state)
	const attribution = deriveMessageAttribution(content, {
		sender: message?.sender || eventOrLine?.sender,
		signerEntityHash,
	})
	const isFromOwner = isTrustedOwnerAttribution(attribution, signerEntityHash, declaredOwnerEntityHash)
	return {
		declaredOwnerEntityHash,
		authorEntityHash: signerEntityHash,
		attribution,
		isFromOwner,
	}
}
