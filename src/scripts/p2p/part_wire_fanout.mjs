import { randomUUID } from 'node:crypto'

import { getNodeHash } from './node/identity.mjs'
import { getShellPartpath } from './part_path_registry.mjs'
import {
	buildPartInvokePayload,
	PART_INVOKE_FANOUT_DEFAULT,
	TIMELINE_FANOUT_LIMIT,
} from './part_wire_common.mjs'
import { pendingPartInvoke } from './part_wire_ingress.mjs'
import { fanoutToTopNodes } from './trust_graph_send.mjs'

/** @typedef {import('./part_invoke.mjs').PartInvokeResponse} PartInvokeResponse */

/**
 * @param {string} username 用户（trust graph fanout 上下文）
 * @param {string} partpath part 路径
 * @param {import('./part_invoke.mjs').PartInvoke} invoke 调用体
 * @param {number} [timeoutMs=2500] 超时
 * @param {number} [maxResponses=6] 最多响应数
 * @returns {Promise<PartInvokeResponse[]>} 邻居 PartInvokeResponse（含 error）
 */
export async function collectPartInvokeResponses(username, partpath, invoke, timeoutMs = 2500, maxResponses = PART_INVOKE_FANOUT_DEFAULT) {
	const requestId = randomUUID()
	const nodeHash = getNodeHash()
	/** @type {PartInvokeResponse[]} */
	const responses = []

	const waitForResponses = new Promise(resolve => {
		/**
		 *
		 */
		const finish = () => {
			clearTimeout(timer)
			pendingPartInvoke.delete(requestId)
			resolve(responses)
		}
		const timer = setTimeout(finish, timeoutMs)
		pendingPartInvoke.set(requestId, { responses, finish, maxResponses, respondedPeers: new Set() })
	})

	const sent = await fanoutToTopNodes(username, 'part_invoke', buildPartInvokePayload({
		partpath,
		invoke,
		nodeHash,
		requestId,
	}), maxResponses)

	const pending = pendingPartInvoke.get(requestId)
	if (pending && sent === 0) pending.finish()

	return waitForResponses
}

/**
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {object} signedEvent 签名事件
 * @returns {Promise<number>} 发送次数
 */
export async function publishTimelineEvent(username, entityHash, signedEvent) {
	return fanoutToTopNodes(username, 'part_timeline_put', {
		nodeHash: getNodeHash(),
		partpath: getShellPartpath('social'),
		timelineEntityHash: entityHash.toLowerCase(),
		event: signedEvent,
	}, TIMELINE_FANOUT_LIMIT)
}

/**
 * 单向 part_invoke fanout（mailbox put 等）。
 * @param {string} username 用户
 * @param {string} partpath part 路径
 * @param {import('./part_invoke.mjs').PartInvoke} invoke 调用体
 * @param {number} limit fanout 上限
 * @param {string} [nodeHash] 来源节点
 * @param {string} [groupId] 群上下文
 * @returns {Promise<number>} 发送次数
 */
export async function fanoutPartInvoke(username, partpath, invoke, limit, nodeHash, groupId) {
	return fanoutToTopNodes(username, 'part_invoke', buildPartInvokePayload({
		partpath,
		invoke,
		nodeHash,
		groupId,
	}), limit)
}
