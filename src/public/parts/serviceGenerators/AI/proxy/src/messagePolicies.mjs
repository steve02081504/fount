/**
 * convert_config 的文件策略（纯逻辑，无 decl 依赖，供 messageBuilder 与 pure 测试共用）。
 */
import { fileMimeType, matchesMimePatterns } from './fileContentParts.mjs'

/**
 * 归一化 MIME 正则配置：兼容旧布尔（`true` = 命中全部），非法值按空列表处理。
 * @param {string[]|boolean|undefined} value 配置值。
 * @returns {string[]} 正则列表。
 */
export function normalizeMimePatterns(value) {
	if (value === true) return ['.*']
	return Array.isArray(value) ? value : []
}

/**
 * 把 MIME 不匹配的附件拆出，命中 `patterns` 的附件转为系统提示文本。
 * @param {object[]} files 附件描述符。
 * @param {string[]} patterns MIME 正则列表。
 * @returns {{ kept: object[], notice: string }} 保留的附件与系统提示。
 */
export function splitDeniedFiles(files, patterns) {
	if (!patterns.length) return { kept: files, notice: '' }
	const kept = []
	const notices = []
	for (const file of files)
		if (matchesMimePatterns(patterns, file))
			notices.push(`[System Notice: can't show you about file '${file.name ?? 'unknown'}' because you cant take the file input of type '${fileMimeType(file)}', but you may be able to access it by using code tools if you have.]`)
		else
			kept.push(file)
	return { kept, notice: notices.join('\n') }
}

/**
 * 指定角色的消息是否携带命中 `patterns` 的附件（命中则须降级为 user）。
 * @param {string} role 消息角色。
 * @param {string} expectedRole 期望匹配的角色。
 * @param {object[]} files 附件描述符。
 * @param {string[]} patterns MIME 正则列表。
 * @returns {boolean} 是否降级。
 */
function roleMessageCarriesDeniedFiles(role, expectedRole, files, patterns) {
	return role === expectedRole && files.some(file => matchesMimePatterns(patterns, file))
}

/**
 * system 消息是否携带命中 `patterns` 的附件。
 * @param {string} role 消息角色。
 * @param {object[]} files 附件描述符。
 * @param {string[]} patterns MIME 正则列表。
 * @returns {boolean} 是否降级。
 */
export function systemMessageCarriesDeniedFiles(role, files, patterns) {
	return roleMessageCarriesDeniedFiles(role, 'system', files, patterns)
}

/**
 * assistant（角色）消息是否携带命中 `patterns` 的附件。
 * 部分来源（如 Kimi）不允许 assistant 消息携带附件，命中则降级为 user 并加 `assistant: ` 前缀。
 * @param {string} role 消息角色。
 * @param {object[]} files 附件描述符。
 * @param {string[]} patterns MIME 正则列表。
 * @returns {boolean} 是否降级。
 */
export function assistantMessageCarriesDeniedFiles(role, files, patterns) {
	return roleMessageCarriesDeniedFiles(role, 'assistant', files, patterns)
}

/**
 * 在消息 content 前加前缀（content 可能是字符串或 content parts 数组）。
 * 数组只在首个 text part 前加一次，与字符串行为一致；无 text part 时补一个。
 * @param {string | object[]} content 原 content。
 * @param {string} prefix 前缀。
 * @returns {string | object[]} 加前缀后的 content。
 */
export function prependText(content, prefix) {
	if (!Array.isArray(content)) return prefix + content
	let prefixed = false
	const parts = content.map(part => {
		if (prefixed || part?.type !== 'text') return part
		prefixed = true
		return { ...part, text: prefix + part.text }
	})
	return prefixed ? parts : [{ type: 'text', text: prefix }, ...parts]
}
