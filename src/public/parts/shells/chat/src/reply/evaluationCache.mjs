/**
 * 【文件】src/reply/evaluationCache.mjs
 * 【职责】ReplyHandler 提前求值（evaluate）的跨阶段缓存：流式预览启动求值，回复管线复用同一结果。
 * 【原理】按 handler name 在 `args.extension.evaluatedToolCalls` 下缓存；签名 = 本轮全部匹配原文拼接，签名变化（重生成/重排）即整体重置；
 *   条目为 `{ settled, value, error, promise }`，promise 永不 reject（错误记入 error），供预览渲染 pending 与管线取 value。
 * 【数据结构】cache = { signature, entries }。
 * 【关联】被 streaming/replyPreviews.mjs 与 reply/handlerPipeline.mjs 共用。
 */

/**
 * 取（必要时创建）某 handler 的求值缓存。
 * @param {object} args 请求上下文
 * @param {string} name handler 名
 * @returns {{ signature: string, entries: object[] }} 缓存
 */
export function getEvaluationCache(args, name) {
	args.extension ??= {}
	args.extension.evaluatedToolCalls ??= {}
	return args.extension.evaluatedToolCalls[name] ??= { signature: '', entries: [] }
}

/**
 * 按当前调用集合同步缓存：签名变化则重置，未启动的调用启动求值。
 * @param {{ signature: string, entries: object[] }} cache 缓存
 * @param {object[]} calls 当前调用集合
 * @param {(call: object, args: object) => Promise<unknown>} evaluate 求值函数
 * @param {object} args 请求上下文
 * @returns {void}
 */
export function syncEvaluationCache(cache, calls, evaluate, args) {
	const signature = calls.map(call => call.raw).join('\u0000')
	if (cache.signature !== signature) {
		cache.signature = signature
		cache.entries = []
	}
	for (let index = 0; index < calls.length; index++)
		if (!cache.entries[index]) {
			const entry = cache.entries[index] = { settled: false }
			entry.promise = Promise.resolve().then(() => evaluate(calls[index], args)).then(
				value => Object.assign(entry, { value, settled: true }),
				error => Object.assign(entry, { error, settled: true }),
			)
		}
}

/**
 * 读取某次调用的求值条目。
 * @param {{ entries: object[] }} cache 缓存
 * @param {number} occurrence 调用出现序号
 * @returns {{ settled: boolean, value?: unknown, error?: Error }} 条目（缺失时按未结算处理）
 */
export function readEvaluatedCall(cache, occurrence) {
	return cache?.entries?.[occurrence] ?? { settled: false }
}
