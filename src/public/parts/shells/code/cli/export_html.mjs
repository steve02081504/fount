import { Marked } from 'npm:marked@^13'

import { escapeHtml } from '../../../../pages/scripts/lib/escapeHtml.mjs'

import { entryText } from './transcript.mjs'

/**
 * 离线导出用 Markdown 解析器：把原文 HTML 转成文本，避免把工具输出里的原始标签
 * （`<img onerror>`、`<script>`）带进独立文件——网页端渲染走 trusted tier，这里是导出的文件策略。
 */
const parser = new Marked({ gfm: true, breaks: false })
/**
 * 把 marked 送来的原文 HTML 转成转义文本。
 * @param {string|object} raw - html token（marked 13 传字符串）。
 * @returns {string} 转义后的文本。
 */
const renderRawHtml = raw => escapeHtml(typeof raw === 'string' ? raw : raw?.text ?? '')
parser.use({ renderer: { html: renderRawHtml } })

/**
 * 取条目标题（工具摘要优先）。
 * @param {object} entry - 会话条目。
 * @returns {string} 标题文本。
 */
function entryHeading(entry) {
	const summary = entry?.extension?.toolCall?.summary
	return String(summary || entry?.name || { char: 'Assistant', tool: 'Tool', system: 'System', user: 'User' }[entry?.role] || entry?.role || 'Entry')
}

/**
 * 把条目附件渲染成列表；带 base64 buffer 的图片内联为 data URL。
 * @param {object[]} files - 附件列表。
 * @returns {string} 附件区 HTML。
 */
function attachmentsHtml(files) {
	const items = []
	for (const file of files || []) {
		const name = escapeHtml(file?.name || 'file')
		const mime = String(file?.mime_type || file?.mimeType || '')
		const dataUrl = typeof file?.buffer === 'string' && mime ? `data:${mime};base64,${file.buffer}` : ''
		if (mime.startsWith('image/') && dataUrl) items.push(`<figure><img src="${escapeHtml(dataUrl)}" alt="${name}" /><figcaption>${name}</figcaption></figure>`)
		else if (dataUrl) items.push(`<p><a href="${escapeHtml(dataUrl)}" download="${name}">${name}</a></p>`)
		else items.push(`<p>${name}</p>`)
	}
	return items.length ? `<div class="attachments">${items.join('')}</div>` : ''
}

/**
 * 把会话条目导出为可离线打开的完整 HTML 文档（无 CDN 依赖）。
 * @param {object[]} entries - 会话条目。
 * @param {object} [options] - 选项。
 * @param {string} [options.title] - 文档标题。
 * @param {string} [options.locale] - `<html lang>` 值。
 * @returns {string} 完整 HTML 文档。
 */
export function transcriptHtml(entries = [], { title = 'fount code session', locale = '' } = {}) {
	const sections = []
	for (const entry of entries) {
		if (!entry || entry.is_generating) continue
		const role = String(entry.role || 'char')
		const body = entryText(entry).trim()
		sections.push(`<section class="entry entry-${escapeHtml(role)}">
<h2>${escapeHtml(entryHeading(entry))}</h2>
${body ? parser.parse(body) : ''}
${attachmentsHtml(entry.files)}
</section>`)
	}
	const heading = escapeHtml(title)
	return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${heading}</title>
<style>
	:root { color-scheme: light dark; }
	body { font-family: sans-serif; line-height: 1.6; margin: 0 auto; max-width: 60rem; padding: 2rem 1rem; }
	h1 { font-size: 1.4rem; }
	h2 { font-size: 1.05rem; margin: 0 0 0.5rem; opacity: 0.75; }
	.entry { margin: 0 0 2rem; }
	.entry-user h2 { color: #1d7fd8; }
	.entry-tool h2, .entry-system h2 { opacity: 0.55; }
	pre { overflow-x: auto; padding: 0.75rem; background: rgba(127, 127, 127, 0.12); }
	code { font-family: monospace; }
	table { border-collapse: collapse; }
	th, td { padding: 0.25rem 0.75rem; text-align: left; }
	img { max-width: 100%; height: auto; }
	blockquote { margin: 0 0 0 0; padding-left: 1rem; opacity: 0.8; }
</style>
</head>
<body>
<h1>${heading}</h1>
${sections.join('\n')}
</body>
</html>
`
}
