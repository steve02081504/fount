/**
 * Social 时间线写入授权（联邦入站 untrusted 边界）。
 */
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { isValidActiveSender } from 'npm:@steve02081504/fount-p2p/federation/operator_key_chain'
import {
	foldOperatorKeyHistoryFromEvents,
	isOperatorTimelineWriteAuthorized,
} from './operator_key_auth.mjs'
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { resolveSocialEntity } from './hosting.mjs'
import { getOperatorEntityHashProvider } from './follower_index_registry.mjs'

/**
 * sender 是否为本机某 agent 实体的合法 operator 活跃钥。
 * @param {string} entityHash 128 位 agent entityHash
 * @param {string} sender 已验签的 sender pubKeyHash（64 hex）
 * @returns {Promise<boolean>} 是否为该 agent 托管节点的 operator 活跃钥
 */
async function isLocalAgentOperator(entityHash, sender) {
	const resolved = await resolveSocialEntity(entityHash)
	if (resolved?.kind !== 'agent' || !resolved.replicaUsername) return false
	const resolveOperator = getOperatorEntityHashProvider()
	if (!resolveOperator) return false
	const operator = await resolveOperator(resolved.replicaUsername)
	if (!operator) return false
	const provider = getOperatorKeyChainProvider()
	if (!provider) return false
	const chain = await provider(resolved.replicaUsername)
	if (!chain?.recoveryPubKeyHex) return false
	return isValidActiveSender(chain.operatorKeyHistory || [], chain.recoveryPubKeyHex, sender)
}

/** @type {((username: string) => Promise<{ recoveryPubKeyHex: string, operatorKeyHistory: object[], activePubKeyHex?: string } | null>) | null} */
let operatorKeyChainProvider = null

/**
 * @param {(username: string) => Promise<object | null>} fn 按 replica 返回密钥链
 * @returns {void}
 */
export function registerOperatorKeyChainProvider(fn) {
	operatorKeyChainProvider = fn
}

/**
 * @returns {((username: string) => Promise<object | null>) | null} 已注册 provider
 */
export function getOperatorKeyChainProvider() {
	return operatorKeyChainProvider
}

/**
 * 判定已验签的 sender 是否有权写入目标时间线（user / agent 统一入口）。
 * @param {string} entityHash 时间线 owner（128 hex）
 * @param {string} sender 事件 sender（已验签的 pubKeyHash，64 hex）
 * @param {object} [opts] 可选上下文
 * @param {string} [opts.eventType] 事件 type
 * @param {object} [opts.eventContent] 事件 content
 * @param {object[]} [opts.priorEvents] 已有事件（折叠密钥链）
 * @returns {Promise<boolean>} 是否授权写入
 */
export async function isTimelineWriteAuthorized(entityHash, sender, opts = {}) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	const normalizedSender = normalizeHex64(sender)
	if (!isHex64(normalizedSender)) return false

	const folded = foldOperatorKeyHistoryFromEvents(opts.priorEvents || [])
	const recoveryPubKeyHex = folded.recoveryPubKeyHex || opts.recoveryPubKeyHex || null
	const operatorKeyHistory = folded.operatorKeyHistory?.length
		? folded.operatorKeyHistory
		: opts.operatorKeyHistory || []

	if (recoveryPubKeyHex && operatorKeyHistory.length)
		if (isOperatorTimelineWriteAuthorized({
			entityHash: parsed.entityHash,
			sender: normalizedSender,
			eventType: opts.eventType || '',
			eventContent: opts.eventContent || {},
			recoveryPubKeyHex,
			operatorKeyHistory,
		}))
			return true

	if (normalizedSender === parsed.subjectHash)
		return true

	return isLocalAgentOperator(parsed.entityHash, normalizedSender)
}
