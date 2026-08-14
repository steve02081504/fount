/**
 * 默认 convert_config（OpenAI 兼容消息转换开关）。
 * @returns {object} convert_config。
 */
export function defaultConvertConfig() {
	return {
		roleReminding: true,
		ignoreFiles: false,
		forceRoleAlternation: false,
		forceUserMessageEnding: false,
		forceNoSystemMessages: false,
	}
}
