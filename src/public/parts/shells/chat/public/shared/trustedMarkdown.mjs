/**
 * 跨壳可信 Markdown：本机两档渲染（可信全文 HTML / 未信任 sanitize）。
 * 勿信任对端预渲染 HTML；勿对 markdown 源做 escapeHtml。
 */
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { createDocumentFragmentFromHtmlStringNoScriptActivation } from '/scripts/features/template.mjs'
import { isTrustedMarkdownAuthor } from '../src/trustedAuthors.mjs'

/**
 * @param {string} markdown markdown 源
 * @param {string} [authorHash] 作者 entityHash / pubKeyHash
 * @param {{
 *   selfEntityHash?: string | null,
 *   nodeHash?: string | null,
 *   viewerOwnerEntityHash?: string | null,
 *   authorEntityHash?: string | null,
 * }} [trustCtx] 信任上下文
 * @returns {Promise<string>} HTML
 */
export async function renderTrustedMarkdownHtml(markdown, authorHash = '', trustCtx = {}) {
	const text = String(markdown || '')
	const trusted = authorHash
		? await isTrustedMarkdownAuthor(authorHash, trustCtx)
		: false
	return renderMarkdownAsString(text, undefined, { allowDangerousHtml: trusted })
}

/**
 * @param {HTMLElement} host 宿主
 * @param {string} markdown markdown 源
 * @param {string} [authorHash] 作者
 * @param {{
 *   selfEntityHash?: string | null,
 *   nodeHash?: string | null,
 *   viewerOwnerEntityHash?: string | null,
 *   authorEntityHash?: string | null,
 * }} [trustCtx] 信任上下文
 * @returns {Promise<void>}
 */
export async function mountTrustedMarkdown(host, markdown, authorHash = '', trustCtx = {}) {
	if (!(host instanceof HTMLElement)) return
	const html = await renderTrustedMarkdownHtml(markdown, authorHash, trustCtx)
	host.classList.add('markdown-body')
	host.replaceChildren(createDocumentFragmentFromHtmlStringNoScriptActivation(html))
}
