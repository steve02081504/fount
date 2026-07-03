import { unwrapPartInvokeResult } from './part_invoke.mjs'

/** 时间线 part_timeline_put fanout 上限 */
export const TIMELINE_FANOUT_LIMIT = 8
/** part_invoke RPC collect 默认响应数 */
export const PART_INVOKE_FANOUT_DEFAULT = 6
/** User Room 随机 peer 转发默认上限 */
export const USER_ROOM_PEER_FANOUT_DEFAULT = 6

/**
 * @param {object} fields 载荷字段
 * @param {string} fields.partpath part 路径
 * @param {import('./part_invoke.mjs').PartInvoke} fields.invoke 调用体
 * @param {string} [fields.nodeHash] 来源节点
 * @param {string} [fields.requestId] RPC 请求 id
 * @param {string} [fields.groupId] 群上下文（mailbox give ingest）
 * @returns {object} part_invoke 线载荷
 */
export function buildPartInvokePayload({ partpath, invoke, nodeHash, requestId, groupId }) {
	return {
		partpath,
		invoke,
		...nodeHash ? { nodeHash } : {},
		...requestId ? { requestId } : {},
		...groupId ? { groupId } : {},
	}
}

/**
 * @param {import('./part_invoke.mjs').PartInvokeResponse[]} results collect 原始结果
 * @returns {object[]} 仅含成功 result 的载荷
 */
export function partInvokeDataRows(results) {
	/** @type {object[]} */
	const rows = []
	for (const row of results) {
		const data = unwrapPartInvokeResult(row)
		if (data != null) rows.push(/** @type {object} */ data)
	}
	return rows
}

/**
 * @param {import('./part_invoke.mjs').PartInvokeResponse[]} results collect 原始结果
 * @returns {string[]} 邻居返回的错误信息
 */
export function partInvokeErrorMessages(results) {
	/** @type {string[]} */
	const errors = []
	for (const row of results) {
		const message = row?.error?.message
		if (message) errors.push(message)
	}
	return errors
}
