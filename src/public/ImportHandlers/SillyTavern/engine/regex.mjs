import { parseRegexFromString } from './tools.mjs'

/**
 * 运行正则表达式
 * @param {import('./charData.mjs').v2CharData} charData 角色数据
 * @param {string} text 文本
 * @param {(e: import('./charData.mjs').regex_script_info) => boolean} filter 过滤器
 * @returns {string} 处理后的文本。
 */
export function runRegex(charData, text, filter = e => true) {
	if (charData?.extensions?.regex_scripts) {
		const WI_regex_scripts = charData.extensions.regex_scripts.filter(filter)
		for (const script of WI_regex_scripts) script.findRegexObject = parseRegexFromString(String(script.findRegex)) || new RegExp(script.findRegex)
		for (const script of WI_regex_scripts)
			text = text.replace(script.findRegexObject, script.replaceString)
		for (const script of WI_regex_scripts)
			delete script.findRegexObject
	}

	return text
}
