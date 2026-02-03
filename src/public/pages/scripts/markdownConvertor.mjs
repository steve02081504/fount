import { fromHtml } from 'https://esm.sh/hast-util-from-html'
import { toHtml } from 'https://esm.sh/hast-util-to-html'
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
import { createHighlighter } from 'https://esm.sh/shiki'
import { unified } from 'https://esm.sh/unified'
import { visit } from 'https://esm.sh/unist-util-visit'

import { geti18n } from './i18n.mjs'
import { onThemeChange } from './theme.mjs'

// --- 辅助函数 ---

/**
 * 向 SVG 字符串添加一个类名。
 * @param {string} svg - SVG 字符串。
 * @param {string} className - 要添加的类名。
 * @returns {string} - 添加了类名的 SVG 字符串。
 */
const addClassToSvg = (svg, className) => svg.replace('<svg', `<svg class="${className}"`)

/**
 * 获取语言的扩展名。
 * @param {string} lang - 语言。
 * @returns {string} - 语言的扩展名。
 */
function getLanguageExtension(lang) {
	return languageMap.extensions(lang)?.[0]?.replace(/^\./, '') || lang
}

// --- Unified.js 插件 ---

/**
 * 禁用某些 micromark 扩展。
 * @param {object} [options={}] - 选项。
 * @returns {void}
 */
function remarkDisable(options = {}) {
	const data = this.data()
	const list = data.micromarkExtensions || (data.micromarkExtensions = [])
	list.push({ disable: { null: options.disable || [] } })
}

/**
 * Discord 剧透文本插件（rehype 阶段）。
 * 支持 ||文本|| 语法，将其转换为剧透文本。
 * @returns {Function} - Unified.js 插件。
 */
function rehypeDiscordSpoiler() {
	return tree => {
		visit(tree, 'text', (node, index, parent) => {
			if (!node.value || !(Object(node.value) instanceof String)) return

			// 跳过代码块中的文本（代码块应该保持原样）
			if (parent?.tagName?.toLowerCase() === 'code' || parent?.tagName?.toLowerCase() === 'pre') return

			// 匹配 ||文本|| 模式（至少包含一个非 | 字符）
			const spoilerRegex = /\|\|([^|]+)\|\|/g
			const matches = [...node.value.matchAll(spoilerRegex)]

			if (!matches.length) return

			// 如果整个文本就是一个剧透，直接替换
			if (matches.length === 1 && matches[0][0] === node.value) {
				const spoilerText = matches[0][1]
				parent.children[index] = {
					type: 'element',
					tagName: 'span',
					properties: {
						className: ['discord-spoiler'],
						style: 'background-color: var(--color-base-content); color: transparent; user-select: none; cursor: pointer; border-radius: 3px;',
						onclick: 'this.removeAttribute("style"); this.removeAttribute("onclick");'
					},
					children: [{ type: 'text', value: spoilerText }]
				}
				return
			}

			// 如果有多个匹配或部分匹配，需要拆分文本节点
			const newNodes = []
			let lastIndex = 0

			for (const match of matches) {
				// 添加匹配前的文本
				if (match.index > lastIndex) {
					const beforeText = node.value.slice(lastIndex, match.index)
					if (beforeText) newNodes.push({ type: 'text', value: beforeText })
				}

				// 添加剧透元素
				const spoilerText = match[1]
				newNodes.push({
					type: 'element',
					tagName: 'span',
					properties: {
						className: ['discord-spoiler'],
						style: 'background-color: var(--color-base-content); color: transparent; user-select: none; cursor: pointer; border-radius: 3px;',
						onclick: 'this.removeAttribute("style"); this.removeAttribute("onclick");'
					},
					children: [{ type: 'text', value: spoilerText }]
				})

				lastIndex = match.index + match[0].length
			}

			// 添加剩余的文本
			if (lastIndex < node.value.length) {
				const afterText = node.value.slice(lastIndex)
				if (afterText) newNodes.push({ type: 'text', value: afterText })
			}

			// 替换原节点
			parent.children.splice(index, 1, ...newNodes)
		})
	}
}

/**
 * 为元素添加 DaisyUI 类。
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
const previewIconCode = await fetch('https://api.iconify.design/line-md/watch.svg').then(res => res.text())

const copyIconSized = addClassToSvg(copyIconCode, iconClass)
const successIconSized = addClassToSvg(successIconCode, iconClass)
const downloadIconSized = addClassToSvg(downloadIconCode, iconClass)
const playIconSized = addClassToSvg(playIconCode, iconClass)
const previewIconSized = addClassToSvg(previewIconCode, iconClass)

/**
 * 工厂函数，用于创建调用 Godbolt API 的执行器函数。
 * @param {string} compilerId - Godbolt 编译器 ID。
 * @param {string} lang - 语言标识符。
 * @returns {(code: string) => Promise<object>} - 一个自包含的异步执行器函数。
 */
const createGodboltExecutor = (compilerId, lang) => {
	const functionBody = `\
const response = await fetch('https://godbolt.org/api/compiler/${compilerId}/compile', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
	body: JSON.stringify({
		source: code,
		compiler: '${compilerId}',
		lang: '${lang}',
		options: { filters: { execute: true } },
	}),
})

if (!response.ok) {
	return { error: \`Godbolt API request failed: \${response.status} \${response.statusText}\` }
}

const data = await response.json()

if (data.code) {
	const errorText = data.stderr.map(e => e.text).join('\\n')
	return { error: \`Compilation failed:\\n\${errorText}\`, exitcode: data.code }
}

const { execResult } = data
const asm = data.asm?.map(a => a.text).join('\\n') || undefined

if (!execResult || !execResult.didExecute) {
	const buildError = execResult?.buildResult?.stderr?.map(e => e.text).join('\\n') || 'Execution did not run. Check for a missing main function or linking error.'
	return { error: \`Build failed:\\n\${buildError}\`, asm }
}

const result = {
	output: execResult.stdout?.map(o => o.text).join('') || undefined,
	error: execResult.stderr?.map(e => e.text).join('') || undefined,
	asm,
	execTime: execResult.execTime,
	exitcode: execResult.code,
}

Object.keys(result).forEach(key => !result[key] && delete result[key])
return result
`
	return new (Object.getPrototypeOf(async function () { }).constructor)('code', functionBody)
}

/**
 * 代码执行器集合
 * @type {Object.<string, (code: string) => Promise<{result?: string, output?: string, error?: string, exitcode?: number, outputHtml?: string, errorHtml?: string}>>}
 */
const languageExecutors = {
	/**
	 * 执行 JavaScript 代码。
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
	 * 执行 Python 代码。
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

			const importRegex = /pyodide\.loadPackage\(\s*\[([^\]]*)]\s*\)/g
			let match
			while ((match = importRegex.exec(code)) !== null) {
				const packages = match[1].split(',').map(p => p.trim().replace(/["']/g, ''))
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
	 * 执行 Ruby 代码。
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
	 * 执行 Lisp 代码。
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
	 * 执行 PHP 代码。
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

			if (error || exitcode)
				return { error: (error || `Exited with code ${exitcode}`).trim(), exitcode }

			return {
				output: output.trim(),
				exitcode,
			}
		} catch (error) { return { error } }
	},
	/**
	 * 执行 Lua 代码。
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
	 * 执行 SQL 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	sql: async (code) => {
		try {
			const { default: initSqlJs } = await import('https://esm.sh/sql.js')
			const SQL = await initSqlJs({
				/**
				 * 定位 SQL.js 文件。
				 * @param {string} file - 文件名。
				 * @returns {string} - 文件路径。
				 */
				locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js/dist/${file}`
			})
			const db = new SQL.Database()
			const results = db.exec(code)

			let output = ''
			if (results.length)
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
	},
	cpp: createGodboltExecutor('gsnapshot', 'c++'),
	c: createGodboltExecutor('cgsnapshot', 'c'),
	csharp: createGodboltExecutor('dotnettrunkcsharpcoreclr', 'csharp'),
	go: createGodboltExecutor('gltip', 'go'),
	rs: createGodboltExecutor('nightly', 'rust'),
	/**
	 * 执行 brainfuck 代码。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<{result?: string, output?: string, error?: string, exitcode?: number}>} - 执行结果。
	 */
	b: async (code) => {
		try {
			const { default: Brainfuck } = await import('https://esm.sh/brainfuck-node')
			const brainfuck = new Brainfuck()
			const result = brainfuck.execute(code)
			return { output: result.output }
		} catch (error) { return { error } }
	},
}

/**
 * 创建代码块插件。
 * @param {object} [options={}] - 选项。
 * @param {boolean} [options.isStandalone=false] - 是否为独立模式。
 * @returns {object} - 代码块插件。
 */
function createCodeBlockPlugin({ isStandalone = false } = {}) {
	return {
		name: 'code-block-enhancements',
		/**
		 * 处理 hast 树。
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
			const executor = languageExecutors[ext] || languageExecutors[lang]

			/**
			 * 创建工具提示。
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
		await navigator.clipboard.writeText(document.querySelector('#${uniqueId} pre').innerText)
		${isStandalone
						? `tooltip.dataset.tip = '${geti18n('code_block.copied.dataset.tip')}'`
						: 'tooltip.dataset.i18n = \'code_block.copied\''
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
						? `tooltip.dataset.tip = '${geti18n('code_block.copy.dataset.tip')}'`
						: 'tooltip.dataset.i18n = \'code_block.copy\''
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
const code = document.querySelector('#${uniqueId} pre').innerText
const a = document.createElement('a')
a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(code)
a.download = \`code.${ext}\`
document.body.appendChild(a)
a.click()
document.body.removeChild(a)
`,
			}, [fromHtml(downloadIconSized, { fragment: true })])

			// 预览按钮
			let previewButtonCore = null
			if (ext === 'html')
				previewButtonCore = h('button', {
					class: 'btn btn-ghost btn-square btn-sm text-icon',
					...isStandalone ? { 'aria-label': geti18n('code_block.preview.aria-label') } : { 'data-i18n': 'code_block.preview' },
					onclick: `\
event.stopPropagation()
const code = document.querySelector('#${uniqueId} pre').innerText
const previewWindow = window.open('', '_blank')
previewWindow.document.write(code)
previewWindow.document.close()
`,
				}, [fromHtml(previewIconSized, { fragment: true })])

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
outputContainer.innerHTML = /* html */ \`\\
<div class="join-item alert">
	${playIconSized}
	<div class="loading loading-spinner"></div>
</div>
\`
codeBlockContainer.insertAdjacentElement('afterend', outputContainer)

const copySvg = decodeURIComponent(${JSON.stringify(encodeURIComponent(copyIconSized))})
const successSvg = decodeURIComponent(${JSON.stringify(encodeURIComponent(successIconSized))})

const createCopyBtn = (text) => {
	const encoded = encodeURIComponent(text).replace(/'/g, '%27')
	const copyAction = \`\\
event.stopPropagation()
const btn = this
navigator.clipboard.writeText(decodeURIComponent('\${encoded}')).then(() => {
	btn.innerHTML = \${JSON.stringify(successSvg)}
	setTimeout(() => btn.innerHTML = \${JSON.stringify(copySvg)}, 2000)
	${isStandalone
							? `btn.parentElement.dataset.tip = decodeURIComponent(${JSON.stringify(encodeURIComponent(geti18n('code_block.copied.dataset.tip')))})`
							: 'btn.parentElement.dataset.i18n = \'code_block.copied\''
}
}).catch(error => {
	${isStandalone
							? 'alert(\'Failed to copy: \' + error.message)'
							: 'import(\'/scripts/toast.mjs\').then(({ showToastI18n }) => showToastI18n(\'error\', \'code_block.copy_failed\', { error: error.message }))'
}
})
\`

	return /* html */ \`\\
<button class="btn btn-ghost btn-square btn-xs absolute top-2 right-2 opacity-70 hover:opacity-100 z-10"
		${isStandalone ? 'aria-label="Copy"' : 'data-i18n="code_block.copy"'}
		onclick="\${copyAction.replace(/"/g, '&quot;')}" >
	\${copySvg}
</button>\`
}

;(${executor.toString()})(document.querySelector('#${uniqueId} pre').innerText).then(async result => {
	result = result || {}
	const { AnsiUp } = await import('https://esm.sh/ansi-up')
	const ansi_up = new AnsiUp()
	const escapeHtml = (str) => ansi_up.ansi_to_html(str)

	let alerts = []

	if (result.error)
		alerts.push(/* html */ \`\\
<div class="join-item alert alert-error bg-error/50 border-error/50 relative pr-10">
	\${createCopyBtn(result.error)}
	<div>
		<div class="font-bold">Error</div>
		<pre class="font-mono text-sm overflow-x-auto whitespace-pre-wrap">\${result.errorHtml || '<code>'+escapeHtml(result.error)+'</code>'}</pre>
	</div>
</div>
\`)
	if (result.output)
		alerts.push(/* html */ \`\\
<div class="join-item alert alert-info bg-info/40 border-info/40 relative pr-10">
	\${createCopyBtn(result.output)}
	<div>
		<div class="font-bold">Output</div>
		<pre class="font-mono text-sm overflow-x-auto whitespace-pre-wrap">\${result.outputHtml || '<code>'+escapeHtml(result.output)+'</code>'}</pre>
	</div>
</div>
\`)
	if (result.asm)
		alerts.push(/* html */ \`\\
<details class="join-item collapse alert alert-warning bg-warning/40 border-warning/40">
	<summary class="collapse-title font-bold text-sm">Assembly</summary>
	<div class="collapse-content relative pr-10">
		\${createCopyBtn(result.asm)}
		<pre class="font-mono text-xs overflow-x-auto">\${result.asmHtml || '<code>'+escapeHtml(result.asm)+'</code>'}</pre>
	</div>
</details>
\`)
	if (result.result)
		alerts.push(/* html */ \`\\
<div class="join-item alert alert-success bg-success/40 border-success/40 relative pr-10">
	\${createCopyBtn(result.result)}
	<div>
		<div class="font-bold">Result</div>
		<pre class="font-mono text-sm font-bold overflow-x-auto whitespace-pre-wrap">\${result.resultHtml || '<code>'+escapeHtml(result.result)+'</code>'}</pre>
	</div>
</div>
\`)

	const footerItems = []
	if (result.execTime)
		footerItems.push(\`<div><div class="text-xs">Execution Time: \${result.execTime} ms</div></div>\`)
	if (result.exitcode)
		footerItems.push(\`<div><div class="text-xs">Exit Code: \${result.exitcode}</div></div>\`)

	if (footerItems.length)
		alerts.push(/* html */ \`\\
<div class="join-item alert alert-secondary bg-secondary/40 border-secondary/40 flex justify-between w-full">
	\${footerItems.join('')}
</div>
\`)

	if (!alerts.length)
		alerts.push(/* html */ \`\\
<div class="join-item alert alert-success bg-success/40 border-success/40">
	<div><div class="text-xs">Execution finished with no output.</div></div>
</div>
\`)

	outputContainer.innerHTML = alerts.join('')
	window.dispatchEvent(new CustomEvent('markdown-codeblock-execution-result', { detail: {
		lang: '${lang}',
		code: document.querySelector('#${uniqueId} pre').innerText,
		...result
	}}))
}).catch(e => {
	outputContainer.innerHTML = /* html */ \`\\
<div class="join-item alert alert-error bg-error/70 border-error/70">
	\${createCopyBtn(e.stack)}
	<div>
		<div class="font-bold">Execution Error</div>
		<pre class="text-xs overflow-x-auto whitespace-pre-wrap"><code>\${e.stack}</code></pre>
	</div>
</div>
\`
	window.dispatchEvent(new CustomEvent('markdown-codeblock-execution-error', { detail: {
		lang: '${lang}',
		code: document.querySelector('#${uniqueId} pre').innerText,
		error: e
	}}))
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
			 * 获取按钮组。
			 * @param {string} tooltipPosition - 工具提示位置。
			 * @returns {object} - 按钮组元素。
			 */
			const getButtonGroup = (tooltipPosition) => {
				const buttons = []
				if (previewButtonCore)
					buttons.push(createTooltip('code_block.preview', [previewButtonCore], tooltipPosition))
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

// --- 缓存插件 ---

/**
 * 读取缓存插件
 * @returns {object} - 读取缓存插件
 */
function rehypeCacheRead() {
	return (tree, file) => {
		const { cache } = file.data
		if (!cache) return

		visit(tree, 'element', (node, index, parent) => {
			// 1. 识别 Mermaid (pre > code.language-mermaid)
			// 2. 识别 普通代码块 (pre > code) - 添加这个以优化 Shiki 高亮性能
			if (node.tagName === 'pre' && node.children?.[0]?.tagName === 'code') {
				const codeNode = node.children[0]
				const className = codeNode.properties.className ??= []
				const content = codeNode.children?.[0]?.value || ''

				// 如果没有语言类，默认添加 language-text，这样 rehype-pretty-code 才会调用 transformer 添加复制按钮
				if (!className.some(c => c.startsWith('language-'))) className.push('language-text')

				// 区分 Mermaid 和普通代码
				const isMermaid = className.includes('language-mermaid')
				const lang = className.find(c => c.startsWith('language-')) || 'text'

				// 生成 Cache Key (包含内容和语言)
				const hash = md5(content + lang)

				// Mermaid 渲染结果在 standalone 和普通模式下相同，使用 common 缓存
				// 普通代码块包含交互按钮，在两种模式下不同，使用 specific 缓存
				const cacheStore = isMermaid ? cache.common : cache.specific
				const cacheKey = isMermaid ? `mermaid-${hash}` : `code-${hash}`

				if (cacheStore && cacheStore[cacheKey]) {
					// HIT: 使用缓存替换当前节点
					const cachedHast = fromHtml(cacheStore[cacheKey], { fragment: true }).children
					parent.children.splice(index, 1, ...cachedHast)
					// 跳过刚插入的节点，避免重复访问
					return index + cachedHast.length
				} else {
					// MISS: 包装节点以便后续插件处理后被 Write 插件捕获
					const wrapper = {
						type: 'element',
						tagName: 'div',
						// 使用通用属性，后续 Write 插件只需检查这个属性
						properties: {
							'data-cache-key': cacheKey,
							'data-cache-store': isMermaid ? 'common' : 'specific',
							style: 'display: contents;'
						},
						children: [node]
					}
					parent.children[index] = wrapper
				}
			}

			// 3. 识别 Math (span.math-inline / div.math-display)
			// Math 渲染结果在 standalone 和普通模式下相同，使用 common 缓存
			if (node.properties?.className?.some(c => c === 'math-inline' || c === 'math-display')) {
				const content = node.children?.[0]?.value || ''
				const hash = md5(content)
				const cacheKey = `math-${hash}`
				const cacheStore = cache.common

				if (cacheStore && cacheStore[cacheKey]) {
					const cachedHast = fromHtml(cacheStore[cacheKey], { fragment: true }).children
					parent.children.splice(index, 1, ...cachedHast)
					return index + cachedHast.length
				} else {
					const wrapper = {
						type: 'element',
						tagName: 'div',
						properties: {
							'data-cache-key': cacheKey,
							'data-cache-store': 'common',
							style: 'display: contents;'
						},
						children: [node]
					}
					parent.children[index] = wrapper
				}
			}
		})
	}
}

/**
 * 写入缓存插件
 * @returns {object} - 写入缓存插件
 */
function rehypeCacheWrite() {
	return (tree, file) => {
		const { cache } = file.data
		if (!cache) return

		visit(tree, 'element', (node, index, parent) => {
			const key = node.properties?.['data-cache-key']
			const storeType = node.properties?.['data-cache-store'] || 'specific'

			if (key) {
				// 根据 storeType 选择缓存存储位置
				const targetStore = cache[storeType] ??= {}

				// 将处理后的子节点序列化为 HTML 字符串存入缓存
				const html = toHtml(node.children)
				targetStore[key] = html

				// 解包：移除 wrapper div，将内容提升到父级
				parent.children.splice(index, 1, ...node.children)

				// 返回当前索引，以便继续正确遍历后续节点
				return index
			}
		})
	}
}

// --- Markdown 转换器 ---

/**
 * 获取 Markdown 转换器。
 * @param {object} [options={}] - 选项。
 * @param {boolean} [options.isStandalone=false] - 是否为独立模式。
 * @returns {Promise<import('npm:unified').Processor>} - Markdown 转换器。
 */
export async function GetMarkdownConvertor({ isStandalone = false } = {}) {
	return unified()
		.use(remarkParse)
		.use(remarkDisable, { disable: ['codeIndented'] })
		.use(remarkBreaks)
		.use(remarkMath)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(remarkGfm, { singleTilde: false })
		.use(rehypeCacheRead)
		.use(rehypeDiscordSpoiler)
		.use(rehypeMermaid, {
			dark: true,
			/**
			 * Mermaid 错误回退。
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
			/**
			 * 扩展默认的高亮器配置
			 * @param {object} options - 选项。
			 * @returns {Promise<import('npm:shiki').Highlighter>} - 高亮器。
			 */
			getHighlighter: options => createHighlighter({
				...options,
				langs: [
					...options.langs,
					async () => ({
						...await fetch('https://cdn.jsdelivr.net/gh/Chris2011/netbeans-textmate-files@master/supported%20languages/brainfuck/brainfuck.tmLanguage.json').then(res => res.json()),
						name: 'brainfuck',
						displayName: 'Brainfuck',
						aliases: ['bf'],
					})
				]
			}),
			transformers: [
				await createCodeBlockPlugin({ isStandalone })
			],
			/**
			 * 访问标题。
			 * @param {object} caption - 标题。
			 * @returns {void}
			 */
			onVisitCaption(caption) {
				caption.properties.className = 'alert alert-secondary shadow-lg join-item'
			},
			/**
			 * 访问标题。
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
						node.properties.className = 'join join-vertical [&:not(:last-child)]:pb-6'
				}, true)
			}
		})
		.use(rehypeKatex)
		.use(rehypeCacheWrite)
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
