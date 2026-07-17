import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { registerDeliveryInboundHandler } from 'npm:@steve02081504/fount-p2p/registries/inbound'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { ensureUserRoom } from 'npm:@steve02081504/fount-p2p/transport/user_room'
import { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } from 'npm:@steve02081504/fount-p2p/trust_graph/registry'
import { collectPartInvokeResponses } from 'npm:@steve02081504/fount-p2p/wire/part_fanout'
import { normalizePartpath } from 'npm:@steve02081504/fount-p2p/wire/part_invoke'

import { getAllUserNames } from '../../../../../../server/auth/index.mjs'
import { hasPartMain } from '../../../../../../server/parts_loader.mjs'

import { loadSharedKeys } from './keys.mjs'
import { persistSharedSnapshot } from './materialize.mjs'
import { ingestSharedOp, loadSharedOps } from './oplog.mjs'

const FANOUT_LIMIT = 16

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object} op op
 * @returns {Promise<void>}
 */
export async function broadcastSharedOp(username, cabinetId, op) {
	await ensureUserRoom({ replicaUsername: username }).catch(() => { })
	const provider = requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER)
	await provider.fanoutToTopNodes(
		username,
		'part_cabinet_op_put',
		{
			nodeHash: getNodeHash(),
			partpath: getShellPartpath('cabinet'),
			cabinetId,
			op,
		},
		FANOUT_LIMIT,
	)
}

/**
 * @param {string} username 用户
 * @param {{ cabinetId: string, op: object, peerNodeHash?: string }} payload 载荷
 * @returns {Promise<'accepted' | 'duplicate' | 'rejected' | 'unknown'>} 结果
 */
export async function handleIncomingSharedOp(username, payload) {
	const cabinetId = String(payload.cabinetId || '')
	const op = payload.op
	if (!cabinetId || !op) return 'unknown'
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys?.write_pubkey) return 'unknown'
	const result = await ingestSharedOp(username, cabinetId, op, keys.write_pubkey, {
		peerNodeHash: payload.peerNodeHash,
	})
	if (result === 'accepted') await persistSharedSnapshot(username, cabinetId)
	return result
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string[]} [haveOpIds] 对端已有
 * @returns {Promise<object[]>} 缺失 ops
 */
export async function exportMissingSharedOps(username, cabinetId, haveOpIds = []) {
	const have = new Set(haveOpIds)
	const ops = await loadSharedOps(username, cabinetId)
	return ops.filter(op => !have.has(op.op_id))
}

/**
 * @param {string} [preferredUsername] 首选
 * @param {string} partpath part
 * @returns {Promise<string | null>} 用户
 */
async function resolveUsernameForCabinet(preferredUsername, partpath) {
	if (preferredUsername && hasPartMain(preferredUsername, partpath)) return preferredUsername
	for (const username of getAllUserNames())
		if (hasPartMain(username, partpath)) return username
	return null
}

/**
 * 注册 part_cabinet_op_put 投递入站。
 * @returns {void}
 */
export function registerCabinetOpInbound() {
	registerDeliveryInboundHandler('part_cabinet_op_put', async (ctx, message) => {
		const partpath = normalizePartpath(message.partpath) || getShellPartpath('cabinet')
		const username = await resolveUsernameForCabinet(ctx.replicaUsername, partpath)
		if (!username) return
		await handleIncomingSharedOp(username, {
			cabinetId: message.cabinetId,
			op: message.op,
			peerNodeHash: ctx.requesterNodeHash ?? message.nodeHash,
		})
	})
}

/**
 * P2PInvoke：put / pull。
 * @param {string} username 用户
 * @param {object} data 载荷
 * @param {{ requesterNodeHash?: string | null }} [ingress] 入站
 * @returns {Promise<object>} 响应
 */
export async function handleCabinetP2PInvoke(username, data, ingress = {}) {
	const kind = String(data?.kind || '')
	if (kind === 'cabinet_op_put') {
		const result = await handleIncomingSharedOp(username, {
			cabinetId: data.cabinetId,
			op: data.op,
			peerNodeHash: ingress.requesterNodeHash,
		})
		return { result: { status: result } }
	}
	if (kind === 'cabinet_op_pull') {
		const ops = await exportMissingSharedOps(username, String(data.cabinetId || ''), data.haveOpIds || [])
		return { result: { ops } }
	}
	return { error: { message: 'unknown_kind', code: 'UNKNOWN' } }
}

/**
 * best-effort：经 part_invoke 向邻居拉缺失 ops。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<number>} 新接受数
 */
export async function pullSharedOpsFromNetwork(username, cabinetId) {
	const local = await loadSharedOps(username, cabinetId)
	const haveOpIds = local.map(op => op.op_id)
	await ensureUserRoom({ replicaUsername: username }).catch(() => { })
	try {
		const replies = await collectPartInvokeResponses(
			username,
			getShellPartpath('cabinet'),
			{ kind: 'cabinet_op_pull', cabinetId, haveOpIds },
			2500,
			FANOUT_LIMIT,
		)
		const keys = await loadSharedKeys(username, cabinetId)
		if (!keys?.write_pubkey) return 0
		let accepted = 0
		for (const reply of replies || []) {
			const ops = reply?.result?.ops
			if (!Array.isArray(ops)) continue
			for (const op of ops) {
				const result = await ingestSharedOp(username, cabinetId, op, keys.write_pubkey)
				if (result === 'accepted') accepted++
			}
		}
		if (accepted) await persistSharedSnapshot(username, cabinetId)
		return accepted
	}
	catch {
		return 0
	}
}
