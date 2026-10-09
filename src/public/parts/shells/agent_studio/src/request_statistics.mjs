/** 轻量请求统计，不依赖生成历史的保留期限。 */
import { estimateTokenCount } from '../../../serviceGenerators/AI/proxy/src/identityTokenizer.mjs'

/**
 * 估算实际请求提示快照中的各类文本 token。
 * 后续提供方输入计量可替换总量；各分类仍明确标记为估算值。
 * @param {object} entry - 已投影的请求快照（`createPromptRequestRecorder` 的产物）。
 * @param {object} prompt - 提示结构。
 * @param {object} source - 当前 AI 源（提供上下文上限）。
 * @returns {object} 上下文快照。
 */
export function requestContextStatistics(entry, prompt, source) {
	const pluginText = Object.values(prompt.plugin_prompts).flatMap(plugin => plugin?.text ?? []).map(part => part.content ?? '').join('\n')
	const tools = estimateTokenCount(pluginText)
	const system = Math.max(0, estimateTokenCount(entry.systemPrompt) - tools)
	const messages = (entry.messages ?? []).reduce((sum, message) => sum + estimateTokenCount(message.content), 0)
	const total = Math.max(system + tools + messages, estimateTokenCount(entry.snapshot))
	return {
		measuredAt: Date.now(), model: entry.model,
		limit: Number.isFinite(source?.context_size) && source.context_size > 0 ? source.context_size : null,
		total, estimated: true,
		components: { system, tools, messages, other: total - system - tools - messages },
	}
}
