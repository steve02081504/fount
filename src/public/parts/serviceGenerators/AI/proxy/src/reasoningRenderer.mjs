import { geti18nForLocales, localhostLocales } from '../../../../../../scripts/i18n/bare.mjs'

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
	const text = geti18nForLocales([...renderOptions.locales ?? [], ...localhostLocales], 'chat.message.view.reasoningDetailsTitle') ?? 'Reasoning'
	const i18nAttr = renderOptions.supported_functions?.fount_i18nkeys ? ' data-i18n="chat.message.view.reasoningDetailsTitle"' : ''
	return `<summary class="fount-reasoning-summary collapse-title min-h-0 py-2 text-sm font-semibold opacity-80 select-none"><span${i18nAttr}>${escapeHtml(text)}</span></summary>`
}

/**
 * 从 reasoning_content / reasoning_summary 构建 Markdown（含 CommonMark HTML 块），置于 content_for_show 开头。
 * - 仅 summary 文案做 HTML 转义；正文原样输出，由下游 Markdown 管线处理代码块等。
 * - `<details>` 开/闭与正文之间必须有空行，否则 CommonMark 会把整段当单一 HTML 块，正文中的 Markdown 不生效。
 * @param {{content: string, extension?: any}} sourceResult - 原始响应结果。
 * @param {{ open?: boolean, locales?: string[], supported_functions?: { fount_i18nkeys?: boolean } }} [renderOptions] - 渲染选项。open 为 true 时默认展开（适用于流式预览）。
 * @returns {string} Markdown 字符串，若无推理内容则返回空字符串。
 */
export function buildReasoningDetailsMarkdown(sourceResult, renderOptions = {}) {
	const reasoningContent = sourceResult.extension?.reasoning_content ?? ''
	const reasoningSummary = sourceResult.extension?.reasoning_summary ?? []

	if (!reasoningContent && !reasoningSummary.length) return ''

	const open = renderOptions.open ?? false
	const body = [
		reasoningContent,
		...reasoningSummary,
	].filter(Boolean).join('\n\n')

	return `\
<details class="fount-reasoning-details collapse collapse-arrow my-2 mb-3 rounded-lg border border-base-content/20 bg-base-200/30" ${open ? ' open' : ''}>

	${reasoningSummaryHtml(renderOptions)}

	<div class="collapse-content">

		${body}

	</div>

</details>
`
}
