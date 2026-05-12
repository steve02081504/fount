import { Buffer } from 'node:buffer'

import { canonicalStringify } from './canonical_json.mjs'
import { sign, verify } from './crypto.mjs'

/**
 * 本地快照 / epoch 锚点载荷（写入每用户 `groups/{id}/snapshot.json`），**非**全局 Home 检查点。
 */

/**
 * 将物化状态与 overlay 打成 chat shell 持久化用的 checkpoint 载荷。
 * @param {{
 *   local_node_id?: string | null,
 *   materialized: object,
 *   epoch_id: number,
 *   checkpoint_event_id: string,
 *   eventIdsInEpoch?: string[],
 *   overlay?: { deletedIds?: unknown, editHistory?: unknown, reactionCounts?: unknown, pins?: unknown, fileIndex?: unknown },
 *   fileFolders?: Record<string, unknown>,
 *   epoch_chain?: object[],
 * }} args 载荷字段
 * @returns {object} 可 JSON 落盘的 checkpoint
 */
export function buildCheckpointPayload({
	local_node_id = null,
	materialized,
	epoch_id,
	checkpoint_event_id,
	eventIdsInEpoch = [],
	overlay = {},
	fileFolders = {},
	epoch_chain = [],
}) {
	const m = materialized
	const mo = m?.messageOverlay || {}
	const serialOverlay = {
		deletedIds: Array.isArray(overlay.deletedIds)
			? overlay.deletedIds
			: [...mo.deletedIds || []],
		editHistory: overlay.editHistory !== undefined && overlay.editHistory !== null
			? overlay.editHistory
			: Object.fromEntries(mo.editHistory || []),
		reactionCounts: overlay.reactionCounts !== undefined && overlay.reactionCounts !== null
			? overlay.reactionCounts
			: Object.fromEntries(mo.reactionCounts || []),
		pins: overlay.pins !== undefined && overlay.pins !== null
			? overlay.pins
			: Object.fromEntries(mo.pins || []),
		fileIndex: overlay.fileIndex !== undefined && overlay.fileIndex !== null
			? overlay.fileIndex
			: Object.fromEntries(mo.fileIndex || []),
	}

	const members_record = {
		groupId: m.groupId,
		members: JSON.parse(JSON.stringify(m.members || {})),
		roles: JSON.parse(JSON.stringify(m.roles || {})),
		channelPermissions: JSON.parse(JSON.stringify(m.channelPermissions || {})),
		channels: JSON.parse(JSON.stringify(m.channels || {})),
		fileFolders: JSON.parse(JSON.stringify(m.fileFolders || {})),
		groupMeta: JSON.parse(JSON.stringify(m.groupMeta || {})),
		groupSettings: JSON.parse(JSON.stringify(m.groupSettings || {})),
		messageOverlay: serialOverlay,
		bannedMembers: [...m.bannedMembers || []],
		delegatedOwnerPubKeyHash: m.delegatedOwnerPubKeyHash ?? null,
		members_root: m.members_root ?? null,
		members_pages_count: m.members_pages_count ?? 1,
		reputationLedger: JSON.parse(JSON.stringify(Array.isArray(m.reputationLedger) ? m.reputationLedger : [])),
		inviteEdges: JSON.parse(JSON.stringify(Array.isArray(m.inviteEdges) ? m.inviteEdges : [])),
	}

	return {
		local_node_id,
		members_record,
		epoch_id,
		checkpoint_event_id,
		eventIdsInEpoch,
		overlay: serialOverlay,
		fileFolders: JSON.parse(JSON.stringify(fileFolders || {})),
		epoch_chain: Array.isArray(epoch_chain) ? epoch_chain : [],
	}
}

/**
 * 由群文件索引推导文件夹视图占位（当前返回空对象，供调用方扩展）。
 * @param {unknown} fileIndex 物化 `messageOverlay.fileIndex` Map 或兼容值
 * @returns {Record<string, unknown>} 文件夹 id → 描述
 */
export function buildFileFoldersSnapshot(fileIndex) {
	void fileIndex
	return {}
}

/**
 * 为 checkpoint 载荷附加 Ed25519 签名（签名字段不包含 `checkpoint_signature` 自身）。
 * @param {object} payload `buildCheckpointPayload` 返回值
 * @param {Uint8Array} secretKey 32 字节种子私钥
 * @returns {Promise<object>} 带 `checkpoint_signature` 的载荷
 */
export async function signCheckpoint(payload, secretKey) {
	const sk = secretKey instanceof Uint8Array ? secretKey : new Uint8Array(secretKey)
	const body = JSON.parse(JSON.stringify(payload))
	delete body.checkpoint_signature
	const msg = Buffer.from(canonicalStringify(body), 'utf8')
	const sig = await sign(msg, sk)
	return { ...payload, checkpoint_signature: Buffer.from(sig).toString('hex') }
}

/**
 * 校验 `checkpoint_signature`（或兼容字段 `owner_signature`）与载荷的 Ed25519 一致性。
 * @param {object} checkpoint 完整检查点对象
 * @param {Uint8Array} ownerPublicKey 32 字节 Ed25519 公钥
 * @returns {Promise<boolean>} 合法为 true
 */
export async function verifyCheckpointSignature(checkpoint, ownerPublicKey) {
	if (!checkpoint || typeof checkpoint !== 'object') return false
	const raw =
		typeof checkpoint.checkpoint_signature === 'string' && checkpoint.checkpoint_signature.trim()
			? checkpoint.checkpoint_signature.trim()
			: typeof checkpoint.owner_signature === 'string' && checkpoint.owner_signature.trim()
				? checkpoint.owner_signature.trim()
				: ''
	if (!/^[0-9a-f]{128}$/iu.test(raw)) return false
	if (!(ownerPublicKey instanceof Uint8Array) || ownerPublicKey.length !== 32) return false
	const body = JSON.parse(JSON.stringify(checkpoint))
	delete body.checkpoint_signature
	delete body.owner_signature
	const msg = Buffer.from(canonicalStringify(body), 'utf8')
	const sig = Buffer.from(raw, 'hex')
	if (sig.length !== 64) return false
	return verify(sig, msg, ownerPublicKey)
}
