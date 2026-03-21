import { escapeRegExp } from '../../../../../../scripts/escape.mjs'

/**
 * 清理 AI 文本响应中的 message/content 包裹标记。
 * @param {string} text - 原始响应文本。
 * @param {(string|RegExp)[]} [alternativeCharnames] - 备选角色名（用于切分多角色内容）。
 * @returns {string} 清理后的纯文本。
 */
export function cleanupResponseText(text, alternativeCharnames = []) {
	if (text.match(/<\/sender>\s*<content>/))
		text = (text.match(/<\/sender>\s*<content>([\S\s]*)/)?.[1] ?? text).split(new RegExp(
			`(${alternativeCharnames.map(Object).map(
				s => s instanceof String ? escapeRegExp(s) : s.source
			).join('|')})\\s*<\\/sender>\\s*<content>`
		)).pop().split(/<\/content>\s*<\/message/).shift()
	if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
		text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()
	text = text.replace(/^\s*<message[^>]*>\s*/, '').replace(/^\s*<content>\s*/, '')
	text = text.replace(/<\/content\s*>/, '').replace(/<\/message[^>]*>/, '').replace(/<\/\s*$/, '')
	return text
}

/**
 * 清理结果对象中的内容展示文本。
 * @param {{ content: string, content_for_show?: string }} res - 待清理的响应对象。
 * @param {(string|RegExp)[]} [alternativeCharnames] - 备选角色名。
 * @returns {{ content: string, content_for_show?: string }} 清理后的响应对象。
 */
export function clearFormat(res, alternativeCharnames = []) {
	res.content = cleanupResponseText(res.content, alternativeCharnames)
	if (res.content_for_show)
		res.content_for_show = cleanupResponseText(res.content_for_show, alternativeCharnames)
	return res
}
