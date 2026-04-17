import { Buffer } from 'node:buffer'

import { canonicalStringify } from './canonical_json.mjs'
import { MEMBERS_PAGE_SIZE } from './constants.mjs'
import { sign as edSign, verify as edVerify } from './crypto.mjs'
import { merkleRoot } from './dag.mjs'

/**
 * 由 fileIndex 物化 Map 生成 folderId → { fileIds } 快照（供 Checkpoint）
 *
 * @param {Map<string, unknown>} [fileIndex] 文件 id → 元数据（含可选 folderId）
 * @returns {Record<string, { fileIds: string[] }>} 文件夹 id 到其下文件 id 列表
 */
export function buildFileFoldersSnapshot(fileIndex) {
	if (!fileIndex || !(fileIndex instanceof Map)) return {}
	/** @type {Map<string, string[]>} */
	const byFolder = new Map()
	for (const [fid, meta] of fileIndex) {
		const m = meta && typeof meta === 'object' ? /** @type {{ folderId?: string }} */ meta : {}
		const folder = m.folderId != null && m.folderId !== '' ? String(m.folderId) : 'default'
		if (!byFolder.has(folder)) byFolder.set(folder, [])
		byFolder.get(folder).push(String(fid))
	}
	/** @type {Record<string, { fileIds: string[] }>} */
	const out = {}
	for (const [folderId, ids] of byFolder) 
		out[folderId] = { fileIds: [...ids].sort() }
	
	return out
}

/**
 * 构建 Checkpoint 可序列化对象（home 签名前）
 *
 * @param {object} p 解构入参
 * @param {string} p.home_node_id 当前 home 节点 id
 * @param {ReturnType<typeof import('./materialized_state.mjs').emptyMaterializedState>} p.materialized 物化群状态
 * @param {string} p.epoch_id 本 checkpoint 所属 epoch
 * @param {string} p.checkpoint_event_id 触发 checkpoint 的事件 id
 * @param {string[]} p.eventIdsInEpoch 本 epoch 内已纳入的事件 id 列表
 * @param {Record<string, unknown>} [p.overlay] 消息层 overlay 快照
 * @param {Record<string, { fileIds: string[] }>} [p.fileFolders] 文件目录快照
 * @param {unknown[]} [p.epoch_chain] epoch 链元数据
 * @returns {object} 可供 canonicalStringify 与签名的纯数据对象
 */
export function buildCheckpointPayload({
	home_node_id,
	materialized,
	epoch_id,
	checkpoint_event_id,
	eventIdsInEpoch,
	overlay = {},
	fileFolders = {},
	epoch_chain = [],
}) {
	const members = [...materialized.members.keys()]
	const pages = []
	for (let i = 0; i < members.length; i += MEMBERS_PAGE_SIZE)
		pages.push(members.slice(i, i + MEMBERS_PAGE_SIZE))

	const memberPageHashes = pages.map((page, idx) =>
		merkleRoot(page.map(h => `${idx}:${h}`)),
	)
	const members_root = merkleRoot(memberPageHashes)
	const epoch_root_hash = merkleRoot(eventIdsInEpoch)

	const rolesObj = Object.fromEntries(materialized.roles)
	const channelsObj = Object.fromEntries(materialized.channels)
	/** 供本地 getState 增量重放：完整成员快照（与 members_root 并存） */
	const members_record = Object.fromEntries(
		[...materialized.members.entries()].map(([k, v]) => [k, {
			pubKeyHex: v.pubKeyHex,
			roles: [...v.roles || []],
			profile: v.profile,
		}]),
	)

	return {
		home_node_id,
		members_root,
		members_pages_count: pages.length,
		members_page_0: pages[0] || [],
		members_record,
		roles: rolesObj,
		channelPermissions: serializeChannelPerms(materialized.channelPermissions),
		channels: channelsObj,
		fileFolders,
		groupMeta: materialized.groupMeta,
		groupSettings: materialized.groupSettings,
		delegatedOwnerPubKeyHash: materialized.delegatedOwnerPubKeyHash ?? null,
		privateMailboxEpochs: Object.fromEntries(materialized.privateMailboxEpochs ?? new Map()),
		messageOverlay: overlay,
		checkpoint_event_id,
		epoch_id,
		eventIdsInEpoch,
		epoch_root_hash,
		epoch_chain,
	}
}

/**
 * @param {object} payload buildCheckpointPayload 的返回值
 * @param {Uint8Array} ownerPrivKey 群主私钥
 * @returns {Promise<object>} 带 owner_signature 的 checkpoint
 */
export async function signCheckpoint(payload, ownerPrivKey) {
	const unsigned = { ...payload }
	delete unsigned.owner_signature
	const msg = new TextEncoder().encode(canonicalStringify(unsigned))
	const sig = await edSign(msg, ownerPrivKey)
	return { ...payload, owner_signature: Buffer.from(sig).toString('hex') }
}

/**
 * @param {object} checkpoint 带 owner_signature 的 checkpoint
 * @param {Uint8Array} ownerPubKey 群主公钥
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyCheckpointSignature(checkpoint, ownerPubKey) {
	const sigHex = checkpoint?.owner_signature
	if (typeof sigHex !== 'string' || !sigHex.trim()) return false
	const sig = Buffer.from(sigHex.trim(), 'hex')
	if (sig.length !== 64) return false
	const unsigned = { ...checkpoint }
	delete unsigned.owner_signature
	const msg = new TextEncoder().encode(canonicalStringify(unsigned))
	return edVerify(new Uint8Array(sig), msg, ownerPubKey)
}

/**
 * 将 channelPermissions Map 转为可 JSON 的普通对象
 *
 * @param {Map<string, Map<string, unknown>>} channelPermMap 频道 id → 角色 id 到 allow/deny 等结构
 * @returns {Record<string, Record<string, unknown>>} `Object.fromEntries` 后的可 JSON 嵌套对象
 */
function serializeChannelPerms(channelPermMap) {
	const out = {}
	for (const [chId, rMap] of channelPermMap)
		out[chId] = Object.fromEntries(rMap)
	return out
}

