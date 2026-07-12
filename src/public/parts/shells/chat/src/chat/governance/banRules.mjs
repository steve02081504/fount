/**
 * 【文件】governance/banRules.mjs
 * 【职责】member_ban DAG 事件内容与物化态 banned* 集合的构建、解析及 unban 目标解析。
 * 【原理】ban 可指向 entityHash 或 nodeHash 作用域；blockEntriesFromBanContent 展开为 state 键；unban 时 member_unban 清理。联邦/本地 append 共用同一套规则，配合 peers 拉黑表。
 * 【数据结构】BanScope entity|node；content 含 targetMemberKey、targetEntityHash/targetNodeHash；state.bannedMembers/Entities/Nodes 为 Set。
 * 【关联】dag/authorizeEvent、peers.mjs、denylist.mjs、entityId.mjs；scripts/p2p/event_types。
 * 术语：**ban**=群成员治理（member_ban）；写入 denylist 的 **deny** 为节点连接拒绝，非 Social **block**。
 */
import { memberEntityHash } from '../lib/entity.mjs'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { resolveTargetMemberKey } from '../dag/reducers/helpers.mjs'

/** @typedef {'entity' | 'node'} BanScope */

/** @type {Set<BanScope>} */
export const BAN_SCOPES = new Set(['entity', 'node'])

/**
 * @param {unknown} scope 封禁范围
 * @returns {boolean} 是否为合法 BanScope
 */
export function isBanScope(scope) {
	return BAN_SCOPES.has(/** @type {BanScope} */ scope)
}

/**
 * 构造 `member_ban` 事件 content。
 * @param {BanScope} banScope entity | node
 * @param {object} memberRow 物化成员
 * @returns {object} DAG content
 */
export function buildMemberBanContent(banScope, memberRow) {
	if (memberRow?.memberKind === 'agent') {
		const targetMemberKey = String(memberRow.agentEntityHash || '').trim().toLowerCase()
		if (!isEntityHash128(targetMemberKey))
			throw new Error('invalid agent member entityHash')
		/** @type {Record<string, string>} */
		const content = { banScope, targetMemberKey }
		if (banScope === 'entity')
			content.targetEntityHash = targetMemberKey
		const homeNodeHash = normalizeHex64(memberRow?.homeNodeHash || '')
		if (banScope === 'node') {
			if (!isHex64(homeNodeHash))
				throw new Error('member missing homeNodeHash for node ban')
			content.targetNodeHash = homeNodeHash
		}
		return content
	}
	const targetMemberKey = normalizeHex64(memberRow?.pubKeyHash || '')
	if (!isHex64(targetMemberKey))
		throw new Error('invalid member pubKeyHash')
	/** @type {Record<string, string>} */
	const content = { banScope, targetMemberKey }
	const homeNodeHash = normalizeHex64(memberRow?.homeNodeHash || '')

	if (banScope === 'entity') {
		const targetEntityHash = memberEntityHash(memberRow)
		if (!isEntityHash128(targetEntityHash))
			throw new Error('cannot derive entity hash from member')
		content.targetEntityHash = targetEntityHash
	}
	if (banScope === 'node') {
		if (!isHex64(homeNodeHash))
			throw new Error('member missing homeNodeHash for node ban')
		content.targetNodeHash = homeNodeHash
	}
	return content
}

/**
 * 从 ban 事件 content 收集应写入 peers/blocklist 的 scope 化条目（联邦入站边界校验）。
 * @param {object} content member_ban content
 * @returns {Array<{ scope: 'subject' | 'entity' | 'node', value: string }>} 去重后的 block 条目
 */
export function blockEntriesFromBanContent(content) {
	/** @type {Map<string, { scope: 'subject' | 'entity' | 'node', value: string }>} */
	const entries = new Map()
	/**
	 * @param {'subject' | 'entity' | 'node'} scope 拉黑范围
	 * @param {string} value 键值
	 */
	const add = (scope, value) => {
		if (!value) return
		entries.set(`${scope}:${value}`, { scope, value })
	}
	const targetMemberKey = resolveTargetMemberKey(content)
	if (isHex64(targetMemberKey)) add('subject', targetMemberKey)
	const entityHash = String(content?.targetEntityHash || '').trim().toLowerCase()
	if (isEntityHash128(entityHash)) add('entity', entityHash)
	const nodeHash = normalizeHex64(content?.targetNodeHash)
	if (isHex64(nodeHash)) add('node', nodeHash)
	return [...entries.values()]
}

/**
 * 从成员行收集 unban 时应清除的键。
 * @param {object} state 物化群状态
 * @param {string} targetMemberKey 成员键
 * @returns {{ pubKeyHash: string | null, entityHash: string|null, nodeHash: string|null }} 应清除的 ban 键
 */
export function unbanTargetsFromMember(state, targetMemberKey) {
	const key = String(targetMemberKey || '').trim().toLowerCase()
	const member = state.members?.[key]
	if (member?.memberKind === 'agent') {
		const agentEntityHash = String(member.agentEntityHash || key).toLowerCase()
		const homeNodeHash = normalizeHex64(member?.homeNodeHash)
		return {
			pubKeyHash: null,
			entityHash: isEntityHash128(agentEntityHash) ? agentEntityHash : null,
			nodeHash: isHex64(homeNodeHash) ? homeNodeHash : null,
		}
	}
	const pubKeyHash = normalizeHex64(key)
	const homeNodeHash = normalizeHex64(member?.homeNodeHash)
	const entityHash = isHex64(pubKeyHash) && isHex64(homeNodeHash) ? `${homeNodeHash}${pubKeyHash}` : null
	return {
		pubKeyHash: isHex64(pubKeyHash) ? pubKeyHash : null,
		entityHash: entityHash && isEntityHash128(entityHash) ? entityHash : null,
		nodeHash: isHex64(homeNodeHash) ? homeNodeHash : null,
	}
}
