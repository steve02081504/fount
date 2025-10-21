import { fromHtml } from 'https://esm.sh/hast-util-from-html'
import { h } from 'https://esm.sh/hastscript'
import languageMap from 'https://esm.sh/language-map'
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
import { createDOMFromHtmlString } from './template.mjs'
import { onThemeChange } from './theme.mjs'

// --- 辅助函数 ---

const addClassToSvg = (svg, className) => svg.replace('<svg', `<svg class="${className}"`)

function getLanguageExtension(lang) {
	const langLower = lang.toLowerCase()
	const langInfo = languageMap[langLower] || Object.values(languageMap).find(info => info.aliases?.map?.(a => a.toLowerCase())?.includes?.(langLower))
	return langInfo?.extensions?.[0]?.replace(/^\./, '') || lang
}

// --- Unified.js 插件 ---

function remarkDisable(options = {}) {
	const data = this.data()
	const list = data.micromarkExtensions || (data.micromarkExtensions = [])
	list.push({ disable: { null: options.disable || [] } })
}

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
 * 代码执行器集合
 * @type {Object.<string, (code: string) => Promise<{result?: string, output?: string, error?: string, exitcode?: number}>>}
 */
const languageExecutors = {
	js: async (code) => {
		try {
			const { async_eval } = await import('https://esm.sh/@steve02081504/async-eval')
			return await async_eval(code)
		} catch (error) { return { error } }
	},
	py: async (code) => {
		try {
			// 动态导入 Pyodide
			const { loadPyodide } = await import('https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.mjs')
			const pyodide = await loadPyodide()

			// 捕获标准输出和错误
			pyodide.runPython(`
                import sys
                import io
                sys.stdout = io.StringIO()
                sys.stderr = io.StringIO()
            `)

			// 检查并加载库
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
	rb: async (code) => {
		try {
			// 动态导入 ruby.wasm
			const { DefaultRubyVM } = await import('https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi/dist/browser/+esm')
			const response = await fetch('https://cdn.jsdelivr.net/npm/@ruby/head-wasm-wasi/dist/ruby+stdlib.wasm')
			const module = await WebAssembly.compileStreaming(response)
			const { vm } = await DefaultRubyVM(module)

			// 重定向标准输出和错误
			const initCode = `
                require 'stringio'
                $stdout = StringIO.new
                $stderr = StringIO.new
            `
			await vm.evalAsync(initCode)

			const result = await vm.evalAsync(code)
			const output = (await vm.evalAsync('$stdout.string')).toString()
			const error = (await vm.evalAsync('$stderr.string')).toString()

			if (error)
				return { error: error.trim() }


			return {
				result: result.toString(),
				output: output.trim(),
			}
		} catch (error) { return { error } }
	},
	lisp: async (code) => {
		try {
			const { exec } = await import('https://esm.sh/lips')
			let output = ''

			const captureOutput = (str) => {
				output += str + '\n'
			}

			const lipsEnv = {
				...exec,
				print: captureOutput
			}

			const result = await new Promise((resolve, reject) => {
				exec(code, lipsEnv).then(resolve).catch(reject)
			})

			return {
				result: result !== undefined && result !== null ? JSON.stringify(result, (key, value) => Object(value) instanceof BigInt ? value.toString() : value) : undefined,
				output: output.trim(),
			}
		} catch (error) { return { error } }
	},
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
	}
}

function createCodeBlockPlugin({ isStandalone = false } = {}) {
	return {
		name: 'code-block-enhancements',
		root(hast) {
			const rawCode = this.tokens.map(line => line.map(token => token.content).join('')).join('\n')
			const lineCount = this.tokens.length
			const collapseThreshold = 13
			const lang = this.options.lang || 'txt'
			const ext = getLanguageExtension(lang)
			const executor = languageExecutors[ext]

			const createTooltip = (textKey, children, position = 'left') => {
				const props = isStandalone
					? { 'data-tip': geti18n(textKey+'.dataset.tip') }
					: { 'data-i18n': textKey }
				return h('div', { class: `tooltip tooltip-${position}`, ...props }, children)
			}

			// 复制按钮
			const copyButtonCore = h('button', {
				class: 'btn btn-ghost btn-square btn-sm text-icon',
				onclick: `\
event.stopPropagation()
const button = this
;(async () => {
	const tooltip = button.parentElement
	try {
		await navigator.clipboard.writeText(${JSON.stringify(rawCode)})
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
				onclick: `\
event.stopPropagation()
const code = ${JSON.stringify(rawCode)}
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
			if (executor) {
				let uniqueId
				do uniqueId = `exec-output-${Math.random().toString(36).slice(2, 9)}`
				while (document.getElementById(uniqueId))
				executeButtonCore = h('button', {
					class: 'btn btn-ghost btn-square btn-sm text-icon',
					onclick: `\
event.stopPropagation()
const codeBlockContainer = this.closest('.group, details')
const preExistingOutput = document.getElementById('${uniqueId}')
if (preExistingOutput) preExistingOutput.remove()

const outputContainer = document.createElement('div')
outputContainer.id = '${uniqueId}'
outputContainer.className = 'mt-1 mb-0'
outputContainer.innerHTML = \`\\
<div class="alert">
	${playIconSized}
	<div class="loading loading-spinner"></div>
</div>
\`
codeBlockContainer.insertAdjacentElement('afterend', outputContainer)

;(${executor})(${JSON.stringify(rawCode)}).then(result => {
	let alerts = []

	if (result.error)
		alerts.push(\`\\
<div class="join-item alert alert-error">
	<div>
		<div class="font-bold">Error</div>
		<pre class="font-mono text-sm overflow-x-auto"><code>\${result.error?.stack || result.error}</code></pre>
	</div>
</div>
\`)
	if (result.output)
		alerts.push(\`\\
<div class="join-item alert alert-info">
	<div>
		<div class="font-bold">Output</div>
		<pre class="font-mono text-sm overflow-x-auto"><code>\${result.output}</code></pre>
	</div>
</div>
\`)
	if (result.result)
		alerts.push(\`\\
<div class="join-item alert alert-success">
	<div>
		<div class="font-bold">Result</div>
		<pre class="font-mono text-sm font-bold overflow-x-auto"><code>\${result.result}</code></pre>
	</div>
</div>
\`)
	if (result.exitcode !== undefined)
		alerts.push(\`\\
<div class="join-item alert alert-secondary">
	<div>
		<div class="text-xs">Exit Code: \${result.exitcode}</div>
	</div>
</div>
\`)

	outputContainer.innerHTML = \`\\
<div class="join-item join join-vertical w-full">\${alerts.join('')}</div>
\`
}).catch(e => {
	outputContainer.innerHTML = \`\\
<div class="alert alert-error">
	<div>
		<div class="font-bold">Execution Error</div>
		<pre class="text-xs overflow-x-auto"><code>\${e.stack}</code></pre>
	</div>
</div>
\`
})
`,
				}, [fromHtml(playIconSized, { fragment: true })])
			}

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
				const summaryNode = h('div', {
					class: 'collapse-title bg-base-200 py-1.5 px-4 rounded-t-md font-mono text-xs font-bold select-none'
				}, `${lang.toUpperCase()} - ${lineCount} lines`)
				const contentNode = h('div', { class: 'collapse-content' }, [hast])
				const buttonNode = h('div', { class: 'absolute top-0 right-10 z-10' }, [getButtonGroup('left')])
				const detailsNode = h('div', { class: 'collapse collapse-arrow rounded-md relative' }, [
					h('input', { type: 'checkbox', checked: true }),
					summaryNode,
					buttonNode,
					contentNode
				])

				return detailsNode
			}

			const buttonNode = h('div', { class: 'absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200' }, [getButtonGroup('left')])
			return h('div', { class: 'group', style: 'position: relative' }, [hast, buttonNode])
		}
	}
}

// --- Markdown 转换器 ---

async function GetConvertor({ isStandalone = false } = {}) {
	return unified()
		.use(remarkParse)
		.use(remarkDisable, { disable: ['codeIndented'] })
		.use(remarkBreaks)
		.use(remarkMath)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(remarkGfm, { singleTilde: false })
		.use(rehypeMermaid, {
			dark: true,
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
		})
		.use(rehypeKatex)
		.use(rehypeAddDaisyuiClass)
		.use(rehypeStringify, {
			allowDangerousCharacters: true,
			allowDangerousHtml: true,
			tightBreaks: true,
		})
}

let convertor, standaloneConvertor

export async function renderMarkdownAsString(markdown) {
	convertor ??= await GetConvertor()
	const file = await convertor.process(markdown)
	return String(file)
}

export async function renderMarkdown(markdown) {
	return createDOMFromHtmlString(await renderMarkdownAsString(markdown))
}

export async function renderMarkdownAsStandAloneHtmlString(markdown) {
	standaloneConvertor ??= await GetConvertor({ isStandalone: true })
	const file = await standaloneConvertor.process(markdown)
	return String(file)
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
