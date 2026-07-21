import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { registerDeliveryInboundHandler } from 'npm:@steve02081504/fount-p2p/registries/inbound'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { ensureUserRoom } from 'npm:@steve02081504/fount-p2p/transport/user_room'
import { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } from 'npm:@steve02081504/fount-p2p/trust_graph/registry'
import { collectPartInvokeResponses } from 'npm:@steve02081504/fount-p2p/wire/part_fanout'
import { normalizePartpath } from 'npm:@steve02081504/fount-p2p/wire/part_invoke'

import { resolveUsernameForPartpath } from '../../../../../../server/p2p_server/inbound_handlers.mjs'

import { loadSharedKeys } from './keys.mjs'
import { persistSharedSnapshot } from './materialize.mjs'
import { ingestSharedOperation, loadSharedOperations } from './operationLog.mjs'

const FANOUT_LIMIT = 16

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object} operation 操作
 * @returns {Promise<void>}
 */
export async function broadcastSharedOperation(username, cabinetId, operation) {
	await ensureUserRoom({ replicaUsername: username }).catch(() => { })
	const provider = requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER)
	await provider.fanoutToTopNodes(
		username,
		'part_cabinet_operation_put',
		{
			nodeHash: getNodeHash(),
			partpath: getShellPartpath('cabinet'),
			cabinetId,
			operation,
		},
		FANOUT_LIMIT,
	)
}

/**
 * @param {string} username 用户
 * @param {{ cabinetId: string, operation: object, peerNodeHash?: string }} payload 载荷
 * @returns {Promise<'accepted' | 'duplicate' | 'rejected' | 'unknown'>} 结果
 */
export async function handleIncomingSharedOperation(username, payload) {
	const cabinetId = String(payload.cabinetId || '')
	const { operation } = payload
	if (!cabinetId || !operation) return 'unknown'
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys?.write_pubkey) return 'unknown'
	const result = await ingestSharedOperation(username, cabinetId, operation, keys.write_pubkey, {
		peerNodeHash: payload.peerNodeHash,
	})
	if (result === 'accepted') await persistSharedSnapshot(username, cabinetId)
	return result
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string[]} [haveOperationIds] 对端已有
 * @returns {Promise<object[]>} 缺失操作
 */
export async function exportMissingSharedOperations(username, cabinetId, haveOperationIds = []) {
	const have = new Set(haveOperationIds)
	return (await loadSharedOperations(username, cabinetId))
		.filter(operation => !have.has(operation.operation_id))
}

/**
 * 注册 part_cabinet_operation_put 投递入站。
 * @returns {void}
 */
export function registerCabinetOperationInbound() {
	registerDeliveryInboundHandler('part_cabinet_operation_put', async (context, message) => {
		const partpath = normalizePartpath(message.partpath) || getShellPartpath('cabinet')
		const username = await resolveUsernameForPartpath(context.replicaUsername, partpath)
		if (!username) return
		await handleIncomingSharedOperation(username, {
			cabinetId: message.cabinetId,
			operation: message.operation,
			peerNodeHash: context.requesterNodeHash ?? message.nodeHash,
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
	if (kind === 'cabinet_operation_put')
		return {
			result: {
				status: await handleIncomingSharedOperation(username, {
					cabinetId: data.cabinetId,
					operation: data.operation,
					peerNodeHash: ingress.requesterNodeHash,
				}),
			},
		}
	if (kind === 'cabinet_operation_pull')
		return {
			result: {
				operations: await exportMissingSharedOperations(
					username,
					String(data.cabinetId || ''),
					data.haveOperationIds || [],
				),
			},
		}
	return { error: { message: 'unknown_kind', code: 'UNKNOWN' } }
}

/**
 * best-effort：经 part_invoke 向邻居拉缺失操作。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<number>} 新接受数
 */
export async function pullSharedOperationsFromNetwork(username, cabinetId) {
	const knownOperationIds = new Set(
		(await loadSharedOperations(username, cabinetId)).map(operation => operation.operation_id),
	)
	await ensureUserRoom({ replicaUsername: username }).catch(() => { })
	try {
		const replies = await collectPartInvokeResponses(
			username,
			getShellPartpath('cabinet'),
			{
				kind: 'cabinet_operation_pull',
				cabinetId,
				haveOperationIds: [...knownOperationIds],
			},
			2500,
			FANOUT_LIMIT,
		)
		const keys = await loadSharedKeys(username, cabinetId)
		if (!keys?.write_pubkey) return 0
		/** @type {Map<string, object>} */
		const incomingById = new Map()
		for (const reply of replies || []) {
			const operations = reply?.result?.operations
			if (!Array.isArray(operations)) continue
			for (const operation of operations) {
				if (
					!operation?.operation_id
					|| knownOperationIds.has(operation.operation_id)
					|| incomingById.has(operation.operation_id)
				) continue
				incomingById.set(operation.operation_id, operation)
			}
		}
		let accepted = 0
		for (const operation of incomingById.values())
			if (await ingestSharedOperation(username, cabinetId, operation, keys.write_pubkey, { knownOperationIds }) === 'accepted')
				accepted++
		if (accepted) await persistSharedSnapshot(username, cabinetId)
		return accepted
	}
	catch {
		return 0
	}
}
