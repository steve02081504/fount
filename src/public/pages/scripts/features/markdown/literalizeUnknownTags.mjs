import { visit } from 'https://esm.sh/unist-util-visit'

/**
 * 判定标签名是否为「未知 HTML 标签」。
 * 本应用不注册任何自定义元素，故带连字符的自定义元素与 `HTMLUnknownElement`（如工具标签
 * `<run-subagent>` / `<list-ai-sources/>`）均无实际渲染行为。
 * @param {string} tagName 小写标签名
 * @returns {boolean} 是否未知
 */
export function isUnknownHtmlTag(tagName) {
	const element = document.createElement(tagName)
	if (globalThis.HTMLUnknownElement && Object(element) instanceof globalThis.HTMLUnknownElement) return true
	return tagName.includes('-') && element.constructor === globalThis.HTMLElement
}

/**
 * 解析前把未知标签的 `<` 转义为 `&lt;`，使被 raw HTML 块吞掉的行重新按 Markdown 解析。
 * 逐轮解析、转义、再解析，直到一轮无改动或达到 8 轮上限；`script` / `style` 块内实体不解码，跳过。
 * @param {string} doc 原始 Markdown
 * @param {(doc: string, file?: object) => object} parse mdast 解析器
 * @param {object | undefined} file 解析附带的 vfile
 * @returns {string} 转义后的 Markdown
 */
function escapeUnknownTags(doc, parse, file) {
	let current = doc
	for (let pass = 0; pass < 8; pass++) {
		const tree = parse(current, file)
		/** @type {number[]} */
		const offsets = []
		visit(tree, 'html', node => {
			const start = node.position?.start?.offset
			const end = node.position?.end?.offset
			if (typeof start !== 'number' || typeof end !== 'number') return
			// 用源码切片而非 node.value：块引用/列表会剥掉 `> `/缩进前缀，值偏移对不上源串
			const slice = current.slice(start, end)
			if (/^<(script|style)\b/i.test(slice)) return
			for (const match of slice.matchAll(/<\/?([a-zA-Z][\w-]*)/g))
				if (isUnknownHtmlTag(match[1].toLowerCase()))
					offsets.push(start + match.index)
		})
		if (!offsets.length) return current
		// 从后往前替换，前面的偏移保持有效；只替换 `<`，保留 `run-js>` 等其余字符
		for (const offset of offsets.sort((a, b) => b - a))
			current = current.slice(0, offset) + '&lt;' + current.slice(offset + 1)
	}
	return current
}

/**
 * 把正文里的未知 HTML 标签从 raw HTML 降级为字面文本（remark 阶段）。
 * 未处理时它们会被下游当 HTML 吞掉、在浏览器里渲染为空，导致推理正文等出现空洞；
 * 此插件在解析前转义未知标签的 `<`，于是被吞的行重新按 Markdown 解析。已知标签与代码节点
 * （行内/围栏代码是 code 节点，不是 html 节点）不受影响。须挂在 `remarkParse` 之后。
 * @returns {void}
 */
export function remarkLiteralizeUnknownHtmlTags() {
	const parse = this.parser
	/**
	 * 包装解析器：解析前先转义未知标签的 `<`。
	 * @param {string} doc 原始 Markdown
	 * @param {object | undefined} file 解析附带的 vfile
	 * @returns {object} mdast 树
	 */
	const parseWithEscape = (doc, file) => parse(escapeUnknownTags(doc, parse, file), file)
	this.parser = parseWithEscape
}
