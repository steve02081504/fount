import { parseRegexFromString } from './tools.mjs'

/**
 * runRegex
 * @param {import('./charData.mjs').v2CharData} charData
 * @param {import('./charData.mjs').regex_placement} regex_type
 * @param {string} text
 */
export function runRegex(charData, regex_type, text) {
	if (charData?.extensions?.regex_scripts) {
		const WI_regex_scripts = charData.extensions.regex_scripts.filter(e => e.placement.includes(regex_type))
		for (const script of WI_regex_scripts) script.findRegexObject = parseRegexFromString(String(script.findRegex)) || new RegExp(script.findRegex)
		for (const script of WI_regex_scripts)
			text = text.replace(script.findRegexObject, script.replaceString)
		for (const script of WI_regex_scripts)
			delete script.findRegexObject
	}

	return text
}
