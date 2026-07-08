/**
 * 【文件】rpcInvoke.mjs — 跨节点群 RPC 调用编排
 * 【职责】统一 invokeGroupRpc：本机 char/world 优先走 session.mjs 本地 RPC；否则经 federation sendRpcToNode 发往归属节点并 await WS 响应。
 * 【原理】partKind 为 char/world 时先 tryInvokeLocal*，命中 result/error 即返回；否则构造 rpc_call 载荷（requestId、memberId、method、args、targetNodeId）异步等待 groupWsRpc。
 * 【数据结构】opts：{ memberId, method, args, targetNodeId, partKind }；requestId（UUID）。
 * 【关联】session.mjs、remoteProxy、groupWsRpc、resolvePart、triggerReply（跨机 GetReply）。
 */
import { randomUUID } from 'node:crypto'

import { sendRpcToNode } from '../federation/remoteProxy.mjs'
import { awaitServerRpcResponse } from '../ws/groupWsRpc.mjs'

import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername 发起方 replica
 * @param {object} opts RPC 选项
 * @returns {Promise<unknown>} RPC 结果或远程调用响应
 */
export async function invokeGroupRpc(groupId, replicaUsername, opts) {
	const { memberId, method, args, targetNodeId, partKind } = opts
	const entry = groupMetadatas.get(groupId)
	const ownerUsername = entry?.username || replicaUsername

	if (partKind === 'char' || partKind === 'world') {
		const { tryInvokeLocalCharRpc, tryInvokeLocalWorldRpc } = await import('../session.mjs')
		const local = partKind === 'char'
			? await tryInvokeLocalCharRpc(groupId, memberId, method, args)
			: await tryInvokeLocalWorldRpc(groupId, memberId, method, args)
		if (local.kind === 'result') return local.value
		if (local.kind === 'error') {
			const err = new Error(local.message || 'RPC error')
			err.code = local.code || 'EXECUTION_ERROR'
			throw err
		}
		// 部件在本机但没有该方法：终止而非转发网络（远端同样不会有）
		if (local.kind === 'method_not_found') {
			const err = new Error(`method not found: ${method}`)
			err.code = 'METHOD_NOT_FOUND'
			throw err
		}
	}

	const requestId = randomUUID()
	const payload = {
		type: 'rpc_call',
		requestId,
		memberId,
		method,
		args,
		ttl: 3,
		targetNodeId,
	}

	await sendRpcToNode(
		targetNodeId ? `node:${targetNodeId}` : undefined,
		ownerUsername,
		groupId,
		payload,
	)

	return awaitServerRpcResponse(requestId)
}
