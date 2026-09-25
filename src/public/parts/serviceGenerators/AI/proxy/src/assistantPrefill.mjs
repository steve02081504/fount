/**
 * assistant 预填充（response prefill）：在出站消息末尾追加一个 assistant 消息，内容为角色信封的开头，
 * 让模型直接从 `<content>` 处续写。适用于 OpenAI Chat Completions / Responses、Anthropic 等支持
 * 「最后一条 assistant 消息作为续写前缀」的 API；不支持该语义的来源必须跳过。
 *
 * 信封格式与 messageBuilder / claude-api 等保持一致：
 * `<message "uid">\n<sender>Charname</sender>\n<content>\n`
 * 模型续写的正文随后由 cleanupResponseText 剥离可能被回显的残余标记。
 */

/**
 * 构建 assistant 预填充信封开头。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @param {string} [uid] - 预填充消息 id；缺省用角色身份（稳定值，利于 prompt 缓存）。
 * @returns {string} assistant 预填充内容（信封开头，末尾带换行）。
 */
export function buildAssistantPrefillEnvelope(prompt_struct, uid = prompt_struct?.CharUid || 'assistant') {
	return `<message "${uid}">\n<sender>${prompt_struct.Charname}</sender>\n<content>\n`
}

/**
 * 解析是否启用 assistant 预填充。
 *
 * `convert_config.assistantPrefill` 默认开启；`forceUserMessageEnding` 明确要求以 user 结尾时让位，
 * 避免与预填充的 assistant 结尾冲突。
 * @param {object} [config] - 服务配置。
 * @param {object} [configTemplate] - 配置模板（默认值）。
 * @returns {boolean} 是否追加预填充。
 */
export function assistantPrefillEnabled(config, configTemplate) {
	const convert_config = { ...configTemplate?.convert_config, ...config?.convert_config }
	if (convert_config.assistantPrefill === false) return false
	if (convert_config.forceUserMessageEnding) return false
	return true
}
