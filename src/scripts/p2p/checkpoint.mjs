import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { canonicalStringify } from './canonical_json.mjs'
import { sign, verify } from './crypto.mjs'
import { computeLocalTipsHash, merkleRoot } from './dag/index.mjs'
import { isHex64 } from './hexIds.mjs'
import { serializeReactionsOverlay, serializeVotesOverlay } from './materialized_state.mjs'

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
 *   overlay?: { deletedIds?: unknown, editHistory?: unknown, feedbackHistory?: unknown, reactions?: unknown, pins?: unknown, fileIndex?: unknown },
 *   fileFolders?: Record<string, unknown>,
 *   epoch_chain?: object[],
 *   dag_tip_ids?: string[],
 *   local_tips_hash?: string | null,
 *   hot_posts?: object,
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
	dag_tip_ids = [],
	local_tips_hash = null,
	hot_posts = null,
}) {
	const materializedState = materialized
	const messageOverlay = materializedState?.messageOverlay || {}
	const serialOverlay = {
		deletedIds: overlay.deletedIds ?? [...messageOverlay.deletedIds || []],
		editHistory: overlay.editHistory ?? Object.fromEntries(messageOverlay.editHistory || []),
		feedbackHistory: overlay.feedbackHistory ?? Object.fromEntries(messageOverlay.feedbackHistory || []),
		reactions: overlay.reactions ?? serializeReactionsOverlay(messageOverlay.reactions),
		pins: overlay.pins ?? Object.fromEntries(messageOverlay.pins || []),
		fileIndex: overlay.fileIndex ?? Object.fromEntries(messageOverlay.fileIndex || []),
		votes: overlay.votes ?? serializeVotesOverlay(messageOverlay.votes),
	}

	const members_record = {
		groupId: materializedState.groupId,
		members: JSON.parse(JSON.stringify(materializedState.members || {})),
		roles: JSON.parse(JSON.stringify(materializedState.roles || {})),
		channelPermissions: JSON.parse(JSON.stringify(materializedState.channelPermissions || {})),
		channelKeyGeneration: JSON.parse(JSON.stringify(materializedState.channelKeyGeneration || {})),
		channelKeyWraps: Object.fromEntries(
			Object.entries(materializedState.channelKeyWraps || {}).map(([channelId, row]) => [
				channelId,
				{ generation: Number(row?.generation) || 0 },
			]),
		),
		channels: JSON.parse(JSON.stringify(materializedState.channels || {})),
		fileFolders: JSON.parse(JSON.stringify(materializedState.fileFolders || {})),
		groupMeta: JSON.parse(JSON.stringify(materializedState.groupMeta || {})),
		groupSettings: JSON.parse(JSON.stringify(materializedState.groupSettings || {})),
		messageOverlay: serialOverlay,
		bannedMembers: [...materializedState.bannedMembers || []],
		bannedEntities: [...materializedState.bannedEntities || []],
		bannedNodes: [...materializedState.bannedNodes || []],
		delegatedOwnerPubKeyHash: materializedState.delegatedOwnerPubKeyHash ?? null,
		ownerHeartbeats: JSON.parse(JSON.stringify(materializedState.ownerHeartbeats || {})),
		membersRoot: materializedState.membersRoot ?? null,
		membersPagesCount: materializedState.membersPagesCount ?? 1,
		reputationLedger: JSON.parse(JSON.stringify(materializedState.reputationLedger || [])),
		inviteEdges: JSON.parse(JSON.stringify(materializedState.inviteEdges || [])),
		fileMasterKeyRotations: JSON.parse(JSON.stringify(materializedState.fileMasterKeyRotations || [])),
		pexHints: [...materializedState.pexHints || []].filter(hint => String(hint).trim()),
		messageSenderIndex: JSON.parse(JSON.stringify(materializedState.messageSenderIndex || {})),
		session: JSON.parse(JSON.stringify(materializedState.session || {})),
	}

	const tips = (Array.isArray(dag_tip_ids) ? dag_tip_ids : []).filter(isHex64)
	const tipsHash = isHex64(local_tips_hash) ? local_tips_hash : computeLocalTipsHash(tips)
	const epochRoot = eventIdsInEpoch.length ? merkleRoot(eventIdsInEpoch) : null

	// §2.1 低功耗节点权限锚：对成员+角色+频道权限计算 SHA-256，供 batterySaver 快速校验
	const batterySaver = !!materializedState.groupSettings?.batterySaver
	let permissionAnchorHash = null
	if (batterySaver) {
		const aclSlice = {
			members: members_record.members,
			roles: members_record.roles,
			channelPermissions: members_record.channelPermissions,
			bannedMembers: members_record.bannedMembers,
			bannedEntities: members_record.bannedEntities,
			bannedNodes: members_record.bannedNodes,
		}
		permissionAnchorHash = createHash('sha256').update(canonicalStringify(aclSlice)).digest('hex')
	}

	return {
		local_node_id,
		members_record,
		epoch_id,
		checkpoint_event_id,
		eventIdsInEpoch,
		epoch_root_hash: epochRoot,
		local_tips_hash: tipsHash,
		dag_tip_ids: tips,
		overlay: serialOverlay,
		fileFolders: JSON.parse(JSON.stringify(fileFolders || {})),
		epoch_chain: Array.isArray(epoch_chain) ? epoch_chain : [],
		...permissionAnchorHash !== null && { permissionAnchorHash },
		...hot_posts && { hot_posts },
	}
}

/**
 * 判断 checkpoint 是否为「owner 签名的权威基态」：含 members_record 且带合法 Ed25519 签名。
 * 新节点入群时可把这种 checkpoint 当作权威基态采纳（无需 pre-checkpoint 历史事件），
 * 之后仅在其上叠加增量事件。WAL / 物化 / checkpoint 重建据此放行「锚点不在本地 DAG」的情形。
 * @param {object | null | undefined} checkpoint checkpoint 对象
 * @returns {boolean} 是否为已签名的基态 checkpoint
 */
export function isSignedBaseCheckpoint(checkpoint) {
	if (!checkpoint || typeof checkpoint !== 'object') return false
	if (!checkpoint.members_record || typeof checkpoint.members_record !== 'object') return false
	return /^[\da-f]{128}$/iu.test(String(checkpoint.checkpoint_signature || '').trim())
}

/**
 * 判断「已签名基态 checkpoint」是否仍是本地权威基态（联邦 catch-up 期间未被本地 DAG 追平/取代）。
 *
 * 新节点入群采纳的 owner 签名 checkpoint 在整个补齐周期内都应被视为权威基态：本地 DAG 可能
 * 尚未拉回锚点、存在悬挂父、锚点已拉回但仍非当前叶、或 `dag_tip_ids` 与本地叶集合未对齐——
 * 这些都属正常中间态而非损坏。若此时强制全量重放，会因本地缺少 pre-checkpoint 治理链而把基态
 * active 成员滤没（ACL 快照变空 → 所有 gated 远端事件被拒）。物化时应以 checkpoint 为基态叠加
 * 本地增量事件（见 materialize.mjs），而非裸 authzFold 全量重放。
 *
 * 退出（supersede）条件：本地叶集合与 `checkpoint.dag_tip_ids` 完全对齐且锚点本身是当前叶之一
 * （即本地 DAG 真正追平）。一旦对齐，常规增量/全量物化即可正确重建，无需基态保护，避免节点
 * 永远停留在采纳基态。另一条 supersede 路径在联邦层：收到更高 epoch 的本地签名 checkpoint 时
 * 直接替换 snapshot.json（见 federation/pullEnvelope.mjs 的 epoch 比较），此处读到的即新基态。
 * @param {object | null | undefined} checkpoint 当前快照
 * @param {string[]} localTipIds 本地 DAG 叶 id（computeDagTipIdsFromEvents 结果）
 * @returns {boolean} 仍需作为采纳签名基态保护时为 true
 */
export function isAdoptedBaseAuthoritative(checkpoint, localTipIds) {
	if (!isSignedBaseCheckpoint(checkpoint)) return false
	const anchor = String(checkpoint.checkpoint_event_id || '').trim().toLowerCase()
	const localTips = (Array.isArray(localTipIds) ? localTipIds : [])
		.map(t => String(t).trim().toLowerCase())
		.filter(isHex64)
	const snapshotTips = (Array.isArray(checkpoint.dag_tip_ids) ? checkpoint.dag_tip_ids : [])
		.map(t => String(t).trim().toLowerCase())
		.filter(isHex64)
	const localSet = new Set(localTips)
	const aligned = localTips.length > 0
		&& snapshotTips.length === localTips.length
		&& snapshotTips.every(t => localSet.has(t))
		&& localSet.has(anchor)
	return !aligned
}

/**
 * 为 checkpoint 载荷附加签名（签名字段不包含 `checkpoint_signature` 自身）。
 * @param {object} payload `buildCheckpointPayload` 返回值
 * @param {Uint8Array} secretKey 32 字节种子私钥
 * @returns {Promise<object>} 带 `checkpoint_signature` 的载荷
 */
export async function signCheckpoint(payload, secretKey) {
	const secretKeyBytes = secretKey instanceof Uint8Array ? secretKey : new Uint8Array(secretKey)
	const body = JSON.parse(JSON.stringify(payload))
	delete body.checkpoint_signature
	const messageBytes = Buffer.from(canonicalStringify(body), 'utf8')
	const signature = await sign(messageBytes, secretKeyBytes)
	return { ...payload, checkpoint_signature: Buffer.from(signature).toString('hex') }
}

/**
 * 校验 `checkpoint_signature` 与载荷的一致性。
 * @param {object} checkpoint 完整检查点对象
 * @param {Uint8Array} ownerPublicKey 32 字节公钥
 * @returns {Promise<boolean>} 合法为 true
 */
export async function verifyCheckpointSignature(checkpoint, ownerPublicKey) {
	const raw = checkpoint?.checkpoint_signature?.trim()
	if (!/^[\da-f]{128}$/iu.test(raw || '')) return false
	if (!(ownerPublicKey instanceof Uint8Array) || ownerPublicKey.length !== 32) return false
	const body = JSON.parse(JSON.stringify(checkpoint))
	delete body.checkpoint_signature
	const messageBytes = Buffer.from(canonicalStringify(body), 'utf8')
	const signature = Buffer.from(raw, 'hex')
	if (signature.length !== 64) return false
	return verify(signature, messageBytes, ownerPublicKey)
}
