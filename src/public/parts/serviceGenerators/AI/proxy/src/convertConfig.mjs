/**
 * 默认 convert_config（OpenAI 兼容消息转换开关）。
 * `ignoreFiles` / `forbidSystemFiles` / `forbidAssistantFiles` 为 MIME 正则列表：前者命中的附件被丢弃并以系统提示占位，
 * `forbidSystemFiles` 命中的附件使该 system 消息降级为 `role: 'user'` 且正文加 `system: ` 前缀；
 * `forbidAssistantFiles` 命中的附件使该 assistant（角色）消息降级为 `role: 'user'` 且正文加 `assistant: ` 前缀
 * （多数 OpenAI 兼容来源不允许 assistant 消息携带附件，可按需配置，默认不启用）。
 * 兼容旧布尔 `ignoreFiles: true`（等价于 `['.*']`）。
 * @returns {object} convert_config。
 */
export function defaultConvertConfig() {
	return {
		roleReminding: true,
		ignoreFiles: [],
		forbidSystemFiles: [],
		forbidAssistantFiles: [],
		forceRoleAlternation: false,
		forceUserMessageEnding: false,
		forceNoSystemMessages: false,
	}
}
