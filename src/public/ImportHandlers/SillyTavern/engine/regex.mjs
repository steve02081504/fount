import { parseRegexFromString } from './tools.mjs'

/**
 * runRegex
 * @param {import('./charData.mjs').v2CharData} charData
 * @param {string} text
 * @param {(e: import('./charData.mjs').regex_script_info) => boolean} filter
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
