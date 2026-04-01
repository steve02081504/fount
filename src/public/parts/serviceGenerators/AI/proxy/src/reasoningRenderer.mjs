import { geti18nForLocales, localhostLocales } from '../../../../../../scripts/i18n.mjs'

/**
 * HTML 转义，防止 XSS。
 * @param {string} str - 待转义的字符串。
 * @returns {string} 转义后的安全字符串。
 */
const escapeHtml = (str) => String(str).replace(/["&'<>]/g, char => ({
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	'\'': '&#39;',
}[char]))

/**
 * 构建 &lt;summary&gt; 的 HTML。服务端预填文案，支持 fount_i18nkeys 时附加 data-i18n 以便客户端语言切换时实时更新。
 * @param {{ locales?: string[], supported_functions?: { fount_i18nkeys?: boolean } }} renderOptions - 渲染选项。
 * @returns {string} summary 元素 HTML。
 */
function reasoningSummaryHtml(renderOptions = {}) {
	const text = geti18nForLocales([...(renderOptions.locales ?? []), ...localhostLocales], 'chat.messageView.reasoningDetailsTitle') ?? 'Reasoning'
	const i18nAttr = renderOptions.supported_functions?.fount_i18nkeys ? ' data-i18n="chat.messageView.reasoningDetailsTitle"' : ''
	return `<summary><span${i18nAttr}>${escapeHtml(text)}</span></summary>`
}

/**
 * 从 reasoning_content / reasoning_summary 构建 <details> 折叠块 HTML，置于 content_for_show 开头。
 * - reasoning_content（DeepSeek 完整 CoT）渲染为折叠块内的预格式文本。
 * - reasoning_summary（OpenAI Responses API 摘要）每条摘要独立一行。
 * @param {{content: string, extension?: any}} sourceResult - 原始响应结果。
 * @param {{ open?: boolean, locales?: string[], supported_functions?: { fount_i18nkeys?: boolean } }} [renderOptions] - 渲染选项。open 为 true 时默认展开（适用于流式预览）。
 * @returns {string} details HTML 字符串，若无推理内容则返回空字符串。
 */
export function buildReasoningDetailsHtml(sourceResult, renderOptions = {}) {
	const reasoningContent = sourceResult.extension?.reasoning_content ?? ''
	const reasoningSummary = sourceResult.extension?.reasoning_summary ?? []

	if (!reasoningContent && !reasoningSummary.length) return ''

	const open = renderOptions.open ?? false

	let bodyHtml = ''

	if (reasoningContent)
		bodyHtml += `<div class="fount-reasoning-content">${escapeHtml(reasoningContent)}</div>`

	for (const text of reasoningSummary)
		bodyHtml += `<div class="fount-reasoning-summary-item">${escapeHtml(text)}</div>`

	return `<details class="fount-reasoning-details"${open ? ' open' : ''}>${reasoningSummaryHtml(renderOptions)}${bodyHtml}</details>`
}
