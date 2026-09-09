/**
 * 按 gist 安全等级渲染 markdown 正文。
 */
import { renderMarkdown, renderMarkdownNoScriptActivation } from '/scripts/features/markdown/index.mjs'

/**
 * 将 gist markdown 按安全等级渲染并替换进容器。
 * secure 档不激活脚本且不信任原始 HTML；trusted 档激活脚本并信任原始 HTML。
 * @param {HTMLElement} container - 目标容器（先清空再插入）。
 * @param {{markdown?: string, securityLevel?: 'secure'|'trusted'}} gist - gist 内容（至少含 markdown / securityLevel）。
 * @returns {Promise<void>} 渲染完成。
 */
export async function renderGistContent(container, gist) {
	container.replaceChildren()
	const markdown = gist.markdown || ''
	if (!markdown.trim()) {
		const empty = document.createElement('div')
		empty.className = 'gist-empty-state'
		empty.dataset.i18n = 'gist.view.empty'
		container.appendChild(empty)
		return
	}
	container.appendChild(gist.securityLevel === 'secure'
		? await renderMarkdownNoScriptActivation(markdown, {}, { allowDangerousHtml: false })
		: await renderMarkdown(markdown, {}, { allowDangerousHtml: true }))
}
