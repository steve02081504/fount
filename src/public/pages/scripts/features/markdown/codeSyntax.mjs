import { visit } from 'https://esm.sh/unist-util-visit'

import { analyzeCode } from '../../components/codeSyntax.mjs'
import { geti18n } from '../../i18n/index.mjs'

/**
 * 把分词与折叠范围渲染成惰性源码 span，并配上可访问的折叠按钮。
 * @param {string} source - 未改动的源码。
 * @param {object} syntax - 共享语法分析结果。
 * @param {object[]} syntax.tokens - 有序高亮范围。
 * @param {object[]} syntax.folds - 语法折叠范围。
 * @returns {object[]} HAST 节点。隐藏的源码仍能被 textContent 与导出读取。
 */
function renderSource(source, { tokens, folds }) {
	let tokenIndex = 0
	const foldLabel = geti18n('util.markdownRichInput.foldCode.aria-label')
	const expandLabel = geti18n('util.markdownRichInput.expandCode.aria-label')
	const ranges = folds.sort((a, b) => a.from - b.from || b.to - a.to)
	/**
	 * 渲染连续的源码片段，保留空白与嵌套范围。
	 * @param {number} from - 起点偏移。
	 * @param {number} to - 终点偏移。
	 * @param {object[]} nested - 落在本片段内的折叠范围。
	 * @returns {object[]} 源码节点。
	 */
	function render(from, to, nested) {
		const nodes = []
		/** @param {number} end - End of the next unfolded segment. @returns {void} */
		function textUntil(end) {
			while (from < end) {
				while (tokens[tokenIndex]?.to <= from) tokenIndex++
				const token = tokens[tokenIndex]
				const stop = Math.min(end, token ? token.from > from ? token.from : token.to : end)
				const text = { type: 'text', value: source.slice(from, stop) }
				nodes.push(token && token.from <= from
					? { type: 'element', tagName: 'span', properties: { style: token.style }, children: [text] }
					: text)
				from = stop
			}
		}
		for (let index = 0; index < nested.length; index++) {
			const range = nested[index]
			if (range.from < from || range.to > to || range.to <= range.from) continue
			textUntil(range.from)
			const children = []
			while (nested[index + 1]?.from < range.to) children.push(nested[++index])
			nodes.push({ type: 'element', tagName: 'button', properties: {
				type: 'button', className: ['fount-code-fold-toggle'], 'aria-expanded': 'true', 'aria-label': foldLabel,
				onClick: `const body=this.nextElementSibling;body.hidden=!body.hidden;this.setAttribute('aria-expanded',String(!body.hidden));this.setAttribute('aria-label',body.hidden?${JSON.stringify(expandLabel)}:${JSON.stringify(foldLabel)})`,
			}, children: [] }, { type: 'element', tagName: 'span', properties: { className: ['fount-code-fold-body'] }, children: render(range.from, range.to, children) })
			from = range.to
		}
		textUntil(to)
		return nodes
	}
	return render(0, source.length, ranges)
}

/**
 * 普通围栏交给文件编辑器的语法；行内代码、不支持的语言以及带 pretty-code
 * 元数据的围栏仍归 pretty-code 处理。
 * @returns {(tree: object) => Promise<void>} rehype 转换器。
 */
export function rehypeCodeSyntax() {
	return async tree => {
		const blocks = []
		visit(tree, 'element', (pre, index, parent) => {
			if (pre.tagName !== 'pre') return
			const code = pre.children?.[0]
			if (code?.tagName !== 'code' || code.data?.meta) return
			const language = code.properties?.className?.find(name => name.startsWith('language-'))?.slice(9)
			if (language && language !== 'mermaid' && language !== 'ansi') blocks.push({ pre, code, index, parent, language })
		})
		await Promise.all(blocks.map(async ({ pre, code, index, parent, language }) => {
			const source = code.children.map(child => child.value || '').join('')
			const syntax = await analyzeCode(source, language)
			pre.data = { ...pre.data, codeLineCount: source.replace(/\n$/, '').split('\n').length }
			pre.properties = { ...pre.properties, className: ['fount-code-syntax'], 'data-language': language, tabIndex: 0 }
			// 去掉 language-* 后，pretty-code 会放过这个已经渲染好的块。
			code.properties = { 'data-language': language }
			code.children = renderSource(source, syntax)
			parent.children[index] = { type: 'element', tagName: 'figure', properties: { 'data-rehype-pretty-code-figure': '' }, children: [pre] }
		}))
	}
}
