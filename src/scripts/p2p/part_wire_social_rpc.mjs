import { getShellPartpath } from './part_path_registry.mjs'
import {
	partInvokeDataRows,
	partInvokeErrorMessages,
	PART_INVOKE_FANOUT_DEFAULT,
} from './part_wire_common.mjs'
import {
	collectPartInvokeResponses,
} from './part_wire_fanout.mjs'

/**
 * @param {object} rpc social RPC 体（不含 kind）
 * @returns {import('./part_invoke.mjs').SocialRpcInvoke} part_invoke 调用体
 */
export function wrapSocialRpc(rpc) {
	return { kind: 'social_rpc', ...rpc }
}

/**
 * @param {string} username 用户
 * @param {object} rpc social RPC 体
 * @param {number} [timeoutMs=2500] 超时
 * @param {number} [maxResponses=6] 最多响应数
 * @returns {Promise<import('./part_invoke.mjs').PartInvokeResponse[]>} 邻居 PartInvokeResponse
 */
export function collectSocialRpcResponses(username, rpc, timeoutMs = 2500, maxResponses = PART_INVOKE_FANOUT_DEFAULT) {
	return collectPartInvokeResponses(username, getShellPartpath('social'), wrapSocialRpc(rpc), timeoutMs, maxResponses)
}

/**
 * @param {string} username 用户
 * @param {object} rpc social RPC 体
 * @param {number} [timeoutMs=2500] 超时
 * @param {number} [maxResponses=6] 最多响应数
 * @returns {Promise<{ data: object[], errors: string[] }>} 成功 data 与邻居 error
 */
export async function collectSocialRpcMerged(username, rpc, timeoutMs = 2500, maxResponses = PART_INVOKE_FANOUT_DEFAULT) {
	const results = await collectSocialRpcResponses(username, rpc, timeoutMs, maxResponses)
	return { data: partInvokeDataRows(results), errors: partInvokeErrorMessages(results) }
}
