import { fromHtml } from 'https://esm.sh/hast-util-from-html'
import { h } from 'https://esm.sh/hastscript'
import languageMap from 'https://esm.sh/lang-map'
import md5 from 'https://esm.sh/md5'
import rehypeKatex from 'https://esm.sh/rehype-katex'
import rehypeMermaid from 'https://esm.sh/rehype-mermaid'
import rehypePrettyCode from 'https://esm.sh/rehype-pretty-code'
import rehypeStringify from 'https://esm.sh/rehype-stringify'
import remarkBreaks from 'https://esm.sh/remark-breaks'
import remarkGfm from 'https://esm.sh/remark-gfm'
import remarkMath from 'https://esm.sh/remark-math'
import remarkParse from 'https://esm.sh/remark-parse'
import remarkRehype from 'https://esm.sh/remark-rehype'
import { unified } from 'https://esm.sh/unified'
import { visit } from 'https://esm.sh/unist-util-visit'

import { geti18n } from './i18n.mjs'
import { onThemeChange } from './theme.mjs'

// --- 辅助函数 ---

/**
 * @description 向 SVG 字符串添加一个类名。
 * @param {string} svg - SVG 字符串。
 * @param {string} className - 要添加的类名。
 * @returns {string} - 添加了类名的 SVG 字符串。
 */
const addClassToSvg = (svg, className) => svg.replace('<svg', `<svg class="${className}"`)

/**
 * @description 获取语言的扩展名。
 * @param {string} lang - 语言。
 * @returns {string} - 语言的扩展名。
 */
function getLanguageExtension(lang) {
	return languageMap.extensions(lang)?.[0]?.replace(/^\./, '') || lang
}

// --- Unified.js 插件 ---

/**
 * @description 禁用某些 micromark 扩展。
 * @param {object} [options={}] - 选项。
 * @returns {void}
 */
function remarkDisable(options = {}) {
	const data = this.data()
	const list = data.micromarkExtensions || (data.micromarkExtensions = [])
	list.push({ disable: { null: options.disable || [] } })
}

/**
 * @description 为元素添加 DaisyUI 类。
 * @returns {Function} - Unified.js 插件。
 */
function rehypeAddDaisyuiClass() {
	return tree => {
		visit(tree, 'element', node => {
			const existingClasses = node.properties.className || []
			let newClasses = []
			switch (node.tagName) {
				case 'hr':
					newClasses = ['divider', 'divider-primary']
					break
				case 'table':
					newClasses = ['table']
					break
				case 'th':
				case 'td':
					newClasses = ['bg-base-100']
					break
				case 'a':
					newClasses = ['link', 'link-primary']
					break
				default:
					return
			}
			node.properties.className = [...newClasses, ...existingClasses]
		})
	}
}

// --- 图标资源 ---

const iconClass = 'w-5 h-5'
const copyIconCode = await fetch('https://api.iconify.design/line-md/clipboard.svg').then(res => res.text())
const successIconCode = await fetch('https://api.iconify.design/line-md/clipboard-check.svg').then(res => res.text())
const downloadIconCode = await fetch('https://api.iconify.design/line-md/download-outline.svg').then(res => res.text())
const playIconCode = await fetch('https://api.iconify.design/line-md/play.svg').then(res => res.text())

const copyIconSized = addClassToSvg(copyIconCode, iconClass)
const successIconSized = addClassToSvg(successIconCode, iconClass)
const downloadIconSized = addClassToSvg(downloadIconCode, iconClass)
const playIconSized = addClassToSvg(playIconCode, iconClass)

/**
 * @description 代码执行器集合
 * @type {Object.<string, (code: string) => Promise<{result?: string, output?: string, error?: string, exitcode?: number}>>}
 */
const languageExecutors = {
	/**
	 * @description 执行 JavaScript 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	js: async (code) => {
		try {
			const { async_eval } = await import('https://esm.sh/@steve02081504/async-eval')
			return await async_eval(code)
		} catch (error) { return { error } }
	},
	/**
	 * @description 执行 Python 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	py: async (code) => {
		try {
			const { loadPyodide } = await import('https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.mjs')
			const pyodide = await loadPyodide()

			pyodide.runPython(`
import sys
import io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
`)

			const importRegex = /pyodide\.loadPackage\(\s*\[([^\]]*)\]\s*\)/g
			let match
			while ((match = importRegex.exec(code)) !== null) {
				const packages = match[1].split(',').map(p => p.trim().replace(/['"]/g, ''))
				await pyodide.loadPackage(packages)
			}

			const result = await pyodide.runPythonAsync(code)
			const output = pyodide.runPython('sys.stdout.getvalue()')
			const error = pyodide.runPython('sys.stderr.getvalue()')

			if (error)
				return { error: error.trim() }

			return {
				result: result !== undefined ? String(result) : undefined,
				output: output.trim(),
			}
		} catch (error) { return { error } }
	},
	/**
	 * @description 执行 Ruby 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	rb: async (code) => {
		try {
			const { DefaultRubyVM } = await import('https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi/dist/browser/+esm')
			const response = await fetch('https://cdn.jsdelivr.net/npm/@ruby/head-wasm-wasi/dist/ruby+stdlib.wasm')
			const module = await WebAssembly.compileStreaming(response)
			const { vm } = await DefaultRubyVM(module)

			const initCode = `
require 'stringio'
$stdout = StringIO.new
$stderr = StringIO.new
`
			await vm.evalAsync(initCode)

			const result = await vm.evalAsync(code)
			const output = (await vm.evalAsync('$stdout.string')).toString()
			const error = (await vm.evalAsync('$stderr.string')).toString()

			if (error) return { error: error.trim() }

			return {
				result: result.toString(),
				output: output.trim(),
			}
		} catch (error) { return { error } }
	},
	/**
	 * @description 执行 Lisp 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	lisp: async (code) => {
		try {
			const { exec } = await import('https://esm.sh/lips')
			const { VirtualConsole } = await import('https://esm.sh/@steve02081504/virtual-console')
			const vc = new VirtualConsole()

			const result = await vc.hookAsyncContext(() => new Promise((resolve, reject) => {
				exec(code).then(resolve).catch(reject)
			}))

			return {
				result: result !== undefined && result !== null ? JSON.stringify(result, (key, value) => {
					value = value?.__value__ ?? value
					if (Object(value) instanceof BigInt)
						if (Number(value) == value)
							value = Number(value)
						else value = value.toString()
					return value
				}) : undefined,
				output: vc.outputs
			}
		} catch (error) { return { error } }
	},
	/**
	 * @description 执行 PHP 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	php: async (code) => {
		try {
			const { PhpWeb } = await import('https://cdn.jsdelivr.net/npm/php-wasm/PhpWeb.mjs')
			const php = new PhpWeb()
			let output = ''
			let error = ''

			php.addEventListener('output', (event) => {
				output += event.detail
			})
			php.addEventListener('error', (event) => {
				error += event.detail
			})

			await new Promise(resolve => php.addEventListener('ready', resolve))

			const exitcode = await php.run(`<?php ${code} ?>`)

			if (error || exitcode !== 0)
				return { error: (error || `Exited with code ${exitcode}`).trim(), exitcode }

			return {
				output: output.trim(),
				exitcode,
			}
		} catch (error) { return { error } }
	},
	/**
	 * @description 执行 Lua 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	lua: async (code) => {
		try {
			const { LuaFactory } = await import('https://esm.sh/wasmoon')
			const factory = new LuaFactory()
			const lua = await factory.createEngine()

			let output = ''
			lua.global.set('print', lua.createFunction((...args) => {
				output += args.map(arg => lua.toString(arg)).join('\t') + '\n'
			}))

			await lua.doString(code)

			return {
				output: output.trim(),
			}
		} catch (error) { return { error } }
	},
	/**
	 * @description 执行 SQL 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	sql: async (code) => {
		try {
			const { default: initSqlJs } = await import('https://esm.sh/sql.js')
			const SQL = await initSqlJs({
				/**
				 * @description 定位 SQL.js 文件。
				 * @param {string} file - 文件名。
				 * @returns {string} - 文件路径。
				 */
				locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js/dist/${file}`
			})
			const db = new SQL.Database()
			const results = db.exec(code)

			let output = ''
			if (results.length > 0)
				output = results.map(res => {
					const header = `| ${res.columns.join(' | ')} |`
					const separator = `|${'-'.repeat(header.length - 2)}|`
					const rows = res.values.map(row => `| ${row.join(' | ')} |`).join('\n')
					return `${header}\n${separator}\n${rows}`
				}).join('\n\n')

			return {
				result: JSON.stringify(results),
				output: output.trim(),
			}
		} catch (error) { return { error } }
	}
}

/**
 * @description 创建代码块插件。
 * @param {object} [options={}] - 选项。
 * @param {boolean} [options.isStandalone=false] - 是否为独立模式。
 * @returns {object} - 代码块插件。
 */
function createCodeBlockPlugin({ isStandalone = false } = {}) {
	return {
		name: 'code-block-enhancements',
		/**
		 * @description 处理 hast 树。
		 * @param {object} hast - hast 树。
		 * @returns {object} - 处理后的 hast 树。
		 */
		root(hast) {
			const rawCode = this.tokens.map(line => line.map(token => token.content).join('')).join('\n')
			const lineCount = this.tokens.length
			const collapseThreshold = 13
			const lang = this.options.lang || 'txt'
			const ext = getLanguageExtension(lang)
			let uniqueId
			do uniqueId = `markdown-code-block-${md5(rawCode)}-${Math.random().toString(36).slice(2, 9)}`
			while (document.getElementById(uniqueId))
			const executor = languageExecutors[ext]

			/**
			 * @description 创建工具提示。
			 * @param {string} textKey - 文本键。
			 * @param {any} children - 子元素。
			 * @param {string} [position='left'] - 位置。
			 * @returns {object} - 工具提示元素。
			 */
			const createTooltip = (textKey, children, position = 'left') => {
				const props = isStandalone
					? { 'data-tip': geti18n(textKey + '.dataset.tip') }
					: { 'data-i18n': textKey }
				return h('div', { class: `tooltip tooltip-${position}`, ...props }, children)
			}

			// 复制按钮
			const copyButtonCore = h('button', {
				class: 'btn btn-ghost btn-square btn-sm text-icon',
				...isStandalone ? { 'aria-label': geti18n('code_block.copy.aria-label') } : { 'data-i18n': 'code_block.copy' },
				onclick: `\
event.stopPropagation()
const button = this
;(async () => {
	const tooltip = button.parentElement
	try {
		await navigator.clipboard.writeText(document.getElementById('${uniqueId}').innerText)
		${isStandalone
			? `tooltip.setAttribute('data-tip', '${geti18n('code_block.copied.dataset.tip')}')`
			: 'tooltip.setAttribute(\'data-i18n\', \'code_block.copied\')'
}
		button.innerHTML = ${JSON.stringify(successIconSized)}
	} catch (e) {
		${isStandalone
			? 'alert(\'Failed to copy: \' + e.message)'
			: 'const { showToastI18n } = await import(\'/scripts/toast.mjs\'); showToastI18n(\'error\', \'code_block.copy_failed\', { error: e.message })'
}
	}
	setTimeout(() => {
		${isStandalone
			? `tooltip.setAttribute('data-tip', '${geti18n('code_block.copy.dataset.tip')}')`
			: 'tooltip.setAttribute(\'data-i18n\', \'code_block.copy\')'
}
		button.innerHTML = ${JSON.stringify(copyIconSized)}
	}, 2000)
})()
`,
			}, [fromHtml(copyIconSized, { fragment: true })])

			// 下载按钮
			const downloadButtonCore = h('button', {
				class: 'btn btn-ghost btn-square btn-sm text-icon',
				...isStandalone ? { 'aria-label': geti18n('code_block.download.aria-label') } : { 'data-i18n': 'code_block.download' },
				onclick: `\
event.stopPropagation()
const code = document.getElementById('${uniqueId}').innerText
const a = document.createElement('a')
a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(code)
a.download = \`code.${ext}\`
document.body.appendChild(a)
a.click()
document.body.removeChild(a)
`,
			}, [fromHtml(downloadIconSized, { fragment: true })])

			// 执行按钮
			let executeButtonCore = null
			if (executor)
				executeButtonCore = h('button', {
					class: 'btn btn-ghost btn-square btn-sm text-icon',
					...isStandalone ? { 'aria-label': geti18n('code_block.execute.aria-label') } : { 'data-i18n': 'code_block.execute' },
					onclick: `\
event.stopPropagation()
const codeBlockContainer = document.getElementById('${uniqueId}')
const preExistingOutput = document.querySelectorAll('.${uniqueId}-execution-output')
for (const output of preExistingOutput) output.remove()

const outputContainer = document.createElement('div')
outputContainer.innerHTML = \`\\
<div class="join-item alert">
	${playIconSized}
	<div class="loading loading-spinner"></div>
</div>
\`
codeBlockContainer.insertAdjacentElement('afterend', outputContainer)

;(${executor})(codeBlockContainer.innerText).then(result => {
	let alerts = []

	if (result.error)
		alerts.push(\`\\
<div class="join-item alert alert-error bg-error/50 border-error/50">
	<div>
		<div class="font-bold">Error</div>
		<pre class="font-mono text-sm overflow-x-auto"><code>\${result.error?.stack || result.error}</code></pre>
	</div>
</div>
\`)
	if (result.output)
		alerts.push(\`\\
<div class="join-item alert alert-info bg-info/40 border-info/40">
	<div>
		<div class="font-bold">Output</div>
		<pre class="font-mono text-sm overflow-x-auto"><code>\${result.output}</code></pre>
	</div>
</div>
\`)
	if (result.result)
		alerts.push(\`\\
<div class="join-item alert alert-success bg-success/40 border-success/40">
	<div>
		<div class="font-bold">Result</div>
		<pre class="font-mono text-sm font-bold overflow-x-auto"><code>\${result.result}</code></pre>
	</div>
</div>
\`)
	if (result.exitcode !== undefined)
		alerts.push(\`\\
<div class="join-item alert alert-secondary bg-secondary/40 border-secondary/40">
	<div>
		<div class="text-xs">Exit Code: \${result.exitcode}</div>
	</div>
</div>
\`)

	outputContainer.innerHTML = alerts.join('')
}).catch(e => {
	outputContainer.innerHTML = \`\\
<div class="join-item alert alert-error bg-error/70 border-error/70">
	<div>
		<div class="font-bold">Execution Error</div>
		<pre class="text-xs overflow-x-auto"><code>\${e.stack}</code></pre>
	</div>
</div>
\`
}).then(() => {
	for (const child of [...outputContainer.children].reverse()) {
		child.classList.add('${uniqueId}-execution-output')
		codeBlockContainer.after(child)
	}
	outputContainer.remove()
})
`,
				}, [fromHtml(playIconSized, { fragment: true })])

			/**
			 * @description 获取按钮组。
			 * @param {string} tooltipPosition - 工具提示位置。
			 * @returns {object} - 按钮组元素。
			 */
			const getButtonGroup = (tooltipPosition) => {
				const buttons = []
				if (executeButtonCore)
					buttons.push(createTooltip('code_block.execute', [executeButtonCore], tooltipPosition))

				buttons.push(
					createTooltip('code_block.download', [downloadButtonCore], tooltipPosition),
					createTooltip('code_block.copy', [copyButtonCore], tooltipPosition)
				)
				return h('div', { class: 'flex items-center' }, buttons)
			}

			if (lineCount > collapseThreshold) {
				const buttonNode = getButtonGroup()
				const summaryNode = h('summary', { class: 'bg-base-200 collapse-title' }, [h('div', {
					class: 'font-mono text-xs font-bold flex items-center justify-between'
				}, [
					h('span', `${lang.toUpperCase()} - ${lineCount} lines`),
					buttonNode
				])])
				return h('details', { id: uniqueId, class: 'markdown-code-block collapse collapse-arrow join-item', open: true }, [
					summaryNode,
					h('div', { class: 'collapse-content' }, [hast])
				])
			}

			const buttonNode = h('div', { class: 'absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200' }, [getButtonGroup('left')])
			return h('div', { id: uniqueId, class: 'markdown-code-block group join-item', style: 'position: relative' }, [hast, buttonNode])
		}
	}
}

// --- Markdown 转换器 ---

/**
 * @description 获取 Markdown 转换器。
 * @param {object} [options={}] - 选项。
 * @param {boolean} [options.isStandalone=false] - 是否为独立模式。
 * @returns {Promise<import('unified').Processor>} - Markdown 转换器。
 */
export async function GetMarkdownConvertor({ isStandalone = false } = {}) {
	return unified()
		.use(remarkParse)
		.use(remarkDisable, { disable: ['codeIndented'] })
		.use(remarkBreaks)
		.use(remarkMath)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(remarkGfm, { singleTilde: false })
		.use(rehypeMermaid, {
			dark: true,
			/**
			 * @description Mermaid 错误回退。
			 * @param {object} element - 元素。
			 * @param {string} diagram - 图表。
			 * @param {Error} error - 错误。
			 * @returns {object} - 回退元素。
			 */
			errorFallback: (element, diagram, error) => {
				// https://github.com/remcohaszing/rehype-mermaid/issues/31
				document.getElementById('dmermaid-0')?.remove()
				document.getElementById('dmermaid-dark-0')?.remove()

				return h('pre.mermaid-error-fallback', `\
❌ Mermaid Diagram Failed to Render
Error: ${error.message}
--- Diagram Source ---
${diagram}`
				)
			}
		})
		.use(rehypePrettyCode, {
			theme: {
				dark: 'github-dark-dimmed',
				light: 'github-light',
			},
			transformers: [
				await createCodeBlockPlugin({ isStandalone })
			],
			/**
			 * @description 访问标题。
			 * @param {object} caption - 标题。
			 * @returns {void}
			 */
			onVisitCaption(caption) {
				caption.properties.className = 'alert alert-secondary shadow-lg join-item'
			},
			/**
			 * @description 访问标题。
			 * @param {object} title - 标题。
			 * @returns {void}
			 */
			onVisitTitle(title) {
				title.properties.className = 'alert alert-info shadow-lg join-item'
			}
		})
		.use(() => {
			return tree => {
				visit(tree, 'element', node => {
					if (!node.properties.className && node.tagName === 'figure' && node.children.some(child => child.properties.className?.includes?.('markdown-code-block')))
						node.properties.className = 'join join-vertical pb-6'
				}, true)
			}
		})
		.use(rehypeKatex)
		.use(rehypeAddDaisyuiClass)
		.use(rehypeStringify, {
			allowDangerousCharacters: true,
			allowDangerousHtml: true,
			tightBreaks: true,
		})
}

// --- 全局样式注入 ---

document.head.prepend(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css' }))

const markdown_style = document.createElement('link')
markdown_style.rel = 'stylesheet'
markdown_style.crossOrigin = 'anonymous'
onThemeChange((theme, is_dark) => {
	markdown_style.href = `https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-${is_dark ? 'dark' : 'light'}.min.css`
})
document.head.prepend(markdown_style)
