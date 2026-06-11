import { async_eval } from 'npm:@steve02081504/async-eval'
import { serializeArgSnapshot } from 'npm:@steve02081504/virtual-console/node'

const WIRE_MAX_DEPTH = 5

/**
 * 将 `async_eval` 结果转为可 JSON 传输的 wire 载荷（与 virtual-console log wire 同形）。
 * @param {{ outputEntries: { toJSON: () => object }[]; result?: unknown; error?: unknown }} evalResult - 求值结果。
 * @returns {object} 含 `outputEntries`、可选 `result` / `error` 快照的对象。
 */
export function serializeEvalWirePayload(evalResult) {
	const payload = {
		outputEntries: evalResult.outputEntries.map(entry => entry.toJSON()),
	}
	if (evalResult.result !== undefined)
		payload.result = serializeArgSnapshot(evalResult.result, { maxDepth: WIRE_MAX_DEPTH })
	if (evalResult.error !== undefined)
		payload.error = serializeArgSnapshot(evalResult.error, { maxDepth: WIRE_MAX_DEPTH })
	return payload
}

/**
 * 在隔离虚拟控制台中异步求值 JavaScript，返回 wire 序列化载荷。
 * @param {string} code - 待求值代码（async-eval 语法）。
 * @returns {Promise<object>} wire JSON 载荷。
 */
export async function runEvalCode(code) {
	const evalResult = await async_eval(code)
	return serializeEvalWirePayload(evalResult)
}
