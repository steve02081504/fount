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
 * 检测 markdown 是否以未闭合的围栏代码块结尾并做安全终止。
 * 流式过程中正文常以未闭合的围栏结尾：remark 会把其后所有内容（含 details 闭合标签、后续 HTML 标记）
 * 吞进代码块，破坏 details 结构并在末尾留下空代码块。此处若结尾围栏内容为空则整行去掉（避免空代码块），
 * 否则补一个闭合围栏（保留已输出的片段且不再吞并后续标签）。
 * @param {string} text - 正文。
 * @returns {string} 修正后的正文（正文完整时原样返回）。
 */
function ensureClosedTrailingCodeFence(text) {
	const lines = String(text ?? '').split('\n')
	let fenceChar = ''
	let fenceLen = 0
	let fenceStart = -1
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].replace(/^ {0,3}/, '')
		const m = line.match(/^(`{3,}|~{3,})([^\n]*)$/)
		if (!m) continue
		const char = m[1][0]
		const info = m[2]
		if (!fenceChar) {
			// 反引号围栏的 info 串不得含反引号，否则不是开围栏
			if (char === '`' && info.includes('`')) continue
			fenceChar = char
			fenceLen = m[1].length
			fenceStart = i
		}
		else if (char === fenceChar && m[1].length >= fenceLen && /^\s*$/.test(info)) {
			fenceChar = ''
			fenceLen = 0
			fenceStart = -1
		}
	}
	if (!fenceChar) return text
	const content = lines.slice(fenceStart + 1).join('\n')
	if (content.trim() === '')
		return lines.slice(0, fenceStart).join('\n')
	return `${text}\n${fenceChar.repeat(fenceLen)}`
}

/**
 * 从 reasoning_content / reasoning_summary 构建 Markdown（含 CommonMark HTML 块），置于 content_for_show 开头。
 * - `<summary>` 标题（i18n 文案）做 HTML 转义；`reasoning_summary` 与正文均原样输出（含 `<gamma>` 等标记），由下游 Markdown 管线处理。
 * - `<details>` 开/闭与正文之间必须有空行，否则 CommonMark 会把整段当单一 HTML 块，正文中的 Markdown 不生效。
 * - 流式（renderOptions.open 为 true）时正文经 ensureClosedTrailingCodeFence 处理：未闭合的围栏不会破坏 `<details>` 结构或产生末尾空代码块；完整（非流式）正文原样输出。
 * @param {{content: string, extension?: any}} sourceResult - 原始响应结果。
 * @param {{ open?: boolean, locales?: string[], supported_functions?: { fount_i18nkeys?: boolean } }} [renderOptions] - 渲染选项。open 为 true 时默认展开（适用于流式预览）。
 * @returns {string} Markdown 字符串，若无推理内容则返回空字符串。
 */
export function buildReasoningDetailsMarkdown(sourceResult, renderOptions = {}) {
	const reasoningContent = sourceResult.extension?.reasoning_content ?? ''
	const reasoningSummary = sourceResult.extension?.reasoning_summary ?? []

	if (!reasoningContent && !reasoningSummary.length) return ''

	const open = renderOptions.open ?? false
	const rawBody = [
		reasoningContent,
		...reasoningSummary,
	].filter(Boolean).join('\n\n')
	const body = open ? ensureClosedTrailingCodeFence(rawBody) : rawBody

	return `\
<details class="fount-reasoning-details collapse collapse-arrow my-2 mb-3 rounded-box border border-base-content/20 bg-base-200/30"${open ? ' open' : ''}>

	${reasoningSummaryHtml(renderOptions)}

	<div class="collapse-content">

		${body}

	</div>

</details>
`
}
