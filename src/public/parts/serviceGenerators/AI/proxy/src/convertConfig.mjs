/**
 * 默认 convert_config（OpenAI 兼容消息转换开关）。
 * `ignoreFiles` / `forbidSystemFiles` 为 MIME 正则列表：前者命中的附件被丢弃并以系统提示占位，
 * 后者命中的附件使该 system 消息降级为 `role: 'user'` 且正文加 `system: ` 前缀。
 * 兼容旧布尔 `ignoreFiles: true`（等价于 `['.*']`）。
 * @returns {object} convert_config。
 */
export function defaultConvertConfig() {
	return {
		roleReminding: true,
		ignoreFiles: [],
		forbidSystemFiles: [],
		forceRoleAlternation: false,
		forceUserMessageEnding: false,
		forceNoSystemMessages: false,
	}
}
