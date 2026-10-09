import { AIOutputDegenerationError, createOutputGuard } from './outputGuard.mjs'

/** 仅用于当前修正请求的指令，不重放失败输出。 */
export const OUTPUT_RECOVERY_PROMPT = 'The previous generation was interrupted because its output appeared to be stuck in a repetition loop. Regenerate the answer to the original task from the beginning. Avoid meaningless repetition of phrases, paragraphs, reasoning steps, or list items. State uncertainty directly instead of repeatedly reconsidering the same point.'

/**
 * 清掉描述单次响应的字段：复用的工具轮结果可能带着上一轮的残留。
 * @param {object} extension Result extension.
 * @returns {void}
 */
function clearSingleResponseFields(extension) {
	for (const key of ['reasoning_content', 'reasoning_summary', 'logprobs', 'logprobs_metrics', 'outputRecovery'])
		delete extension[key]
}

/**
 * 追加修正提示，同时保留配置的角色限制和 assistant 预填充。
 * @param {object[]} messages Original outbound messages.
 * @param {object} config Source configuration.
 * @returns {object[]} Independent retry messages.
 */
export function recoveryMessages(messages, config) {
	const converted = [...messages]
	const last = converted.at(-1)
	const prefill = last?.role === 'assistant' && typeof last.content === 'string' && /^<message [^\n]+>\n<sender>[^\n]*<\/sender>\n<content>\n$/u.test(last.content) ? converted.pop() : null
	const policy = config.convert_config ?? {}
	const noSystem = policy.forceNoSystemMessages
	const notice = { role: noSystem ? 'user' : 'system', content: (noSystem ? 'system: ' : '') + OUTPUT_RECOVERY_PROMPT }
	// 修正提示要么插在最后一条原消息前（替代它成为收尾的 user），要么就是最后一条本身。
	if (policy.forceRoleAlternation && converted.at(-1)?.role === notice.role)
		converted.push({ role: notice.role === 'user' ? 'assistant' : 'user', content: '(continue)' })
	if (policy.forceUserMessageEnding && notice.role !== 'user') converted.push(notice, { role: 'user', content: '(continue)' })
	else converted.push(notice)
	if (prefill) converted.push(prefill)
	return converted
}

/**
 * 最多生成两次；每次请求内部仍沿用原有端点发现流程。
 * @param {Function} request Existing candidate request function.
 * @param {object} config Source configuration; output_recovery=false disables detection.
 * @returns {Function} Guarded request function.
 */
export function withOutputRecovery(request, config) {
	return async (messages, options = {}) => {
		if (config.output_recovery === false) return request(messages, options)
		const result = options.result ?? { content: '', files: [] }
		const initialFiles = [...result.files]
		result.extension ??= {}
		// 必须原地清空：计量记录器持有同一个 extension 对象，替换引用会让它写丢计量。
		clearSingleResponseFields(result.extension)
		const initialExtension = { ...result.extension }
		const incidents = []
		for (let attempt = 1; attempt <= 2; attempt++) {
			options.signal?.throwIfAborted()
			if (incidents.length) result.extension.outputRecovery.attempts = attempt
			const controller = new AbortController()
			const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
			const guard = createOutputGuard()
			try {
				return await request(attempt === 1 ? messages : recoveryMessages(messages, config), {
					...options,
					result,
					signal,
					/**
					 * @param {object} partial Raw result before rendering.
					 * @param {boolean} [final] End of model output.
					 * @returns {void}
					 */
					inspectOutput(partial, final) {
						try { guard.inspect(partial, final) }
						catch (error) {
							controller.abort(error)
							throw error
						}
					},
				})
			} catch (error) {
				options.signal?.throwIfAborted()
				if (!(error instanceof AIOutputDegenerationError)) throw error
				incidents.push({ attempt, ...error.evidence })
				result.extension.outputRecovery = { attempts: attempt, incidents: [...incidents] }
				if (attempt === 2) throw error
				// 保留计量与请求区间，丢弃这次尝试的其余载荷；重试从原始消息重新生成。
				const { usage, modelCalls } = result.extension
				result.content = ''
				result.files = [...initialFiles]
				delete result.content_for_show
				for (const key of Object.keys(result.extension)) delete result.extension[key]
				Object.assign(result.extension, initialExtension, { usage, modelCalls, outputRecovery: { attempts: attempt, incidents: [...incidents] } })
				options.onGenerationRestart?.({ attempt: 2, reason: error.code })
				options.signal?.throwIfAborted()
				options.previewUpdater?.(result)
			}
		}
	}
}
