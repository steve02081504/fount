/**
 * 粘贴内容危险检测：仅用惰性 `<template>` 解析（不执行脚本、不加载资源），
 * 依据共享 sanitizeHtml 的阻断标签 / 事件属性 / 危险 URL 规则判断粘贴是否可能执行脚本。
 */
import { BLOCKED_HTML_TAGS, isSafeHtmlUrl, URL_HTML_ATTRIBUTES } from '/scripts/lib/sanitizeHtml.mjs'

/**
 * 判断粘贴的 HTML 是否包含潜在危险内容。
 * @param {string} html - 剪贴板 text/html 原文（可含脚本 / 事件属性 / 危险链接）。
 * @returns {boolean} 存在危险则返回 true，否则 false。
 */
export function detectPasteDanger(html) {
	if (!html) return false
	const template = document.createElement('template')
	template.innerHTML = html
	for (const element of template.content.querySelectorAll('*')) {
		const tagName = element.tagName.toLowerCase()
		if (BLOCKED_HTML_TAGS.has(tagName)) return true
		for (const attribute of element.attributes) {
			const name = attribute.name.toLowerCase()
			if (name.startsWith('on')) return true
			if (URL_HTML_ATTRIBUTES.has(name) && !isSafeHtmlUrl(attribute.value)) return true
		}
	}
	return false
}
