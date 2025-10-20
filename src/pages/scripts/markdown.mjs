import { h } from 'https://esm.sh/hastscript'
import { fromHtml } from 'https://esm.sh/hast-util-from-html';
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

import { createDOMFromHtmlString } from './template.mjs'
import { onThemeChange } from './theme.mjs'
import { geti18n } from './i18n.mjs'

function remarkDisable(options = {}) {
	const data = this.data()
	const list = data.micromarkExtensions || (data.micromarkExtensions = [])
	list.push({ disable: { null: options.disable || [] } })
}

function rehypeAddDaisyuiClass() {
	return tree => {
		visit(tree, 'element', node => {
			if (node.tagName === 'hr')
				node.properties.className = ['divider', 'divider-primary', ...node.properties.className || []]
			else if (node.tagName === 'table')
				node.properties.className = ['table', ...node.properties.className || []]
			else if (node.tagName === 'th' || node.tagName === 'td')
				node.properties.className = ['bg-base-100', ...node.properties.className || []]
			else if (node.tagName === 'a')
				node.properties.className = ['link', 'link-primary', ...node.properties.className || []]
		})
	}
}

const ShikiCopyButtonPlugin = {
	name: 'copy-button',
	root(hast) {
		const rawCode = this.tokens.map(line => line.map(token => token.content).join('')).join('\n')

		const copyIconSrc = 'https://api.iconify.design/line-md/clipboard.svg'
		const successIconSrc = 'https://api.iconify.design/line-md/clipboard-check.svg'

		const buttonNode = h('div', {
			class: 'absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200'
		}, [
			h('div', {
				class: 'tooltip tooltip-left',
				'data-i18n': 'copy_button.copy',
			}, [
				h('button', {
					class: 'btn btn-ghost btn-square btn-sm text-icon',
					onclick: `(async () => {
						const { getSvgIcon } = await import('/scripts/svgInliner.mjs')
						const tooltip = this.parentElement
						const icon = this.querySelector('svg')
						try {
							await navigator.clipboard.writeText(${JSON.stringify(rawCode)})
							const successIcon = await getSvgIcon('${successIconSrc}', { class: 'w-5 h-5' })
							tooltip.setAttribute('data-i18n', 'copy_button.copied')
							icon.replaceWith(successIcon)
						} catch (e) {
							const { showToastI18n } = await import('/scripts/toast.mjs')
							showToastI18n('error', 'copy_button.copy_failed', { error: e.message })
						}
						setTimeout(async () => {
							tooltip.setAttribute('data-i18n', 'copy_button.copy')
							const icon = this.querySelector('svg')
							icon.replaceWith(await getSvgIcon('${copyIconSrc}', { class: 'w-5 h-5' }))
						}, 2000)
					})()`,
				}, [
					h('img', {
						src: copyIconSrc,
						class: 'w-5 h-5'
					})
				])
			])
		])

		return h('div', { class: 'group', style: 'position: relative;' }, [
			hast,
			buttonNode
		])
	}
}

const SimpleShikiCopyButtonPlugin = async ({ copyText, copiedText }) => {
	const copyIconCode = await fetch('https://api.iconify.design/line-md/clipboard.svg').then(res => res.text())
	const successIconCode = await fetch('https://api.iconify.design/line-md/clipboard-check.svg').then(res => res.text())
	return {
		name: 'simple-copy-button',
		root(hast) {
			const rawCode = this.tokens.map(line => line.map(token => token.content).join('')).join('\n')
			const copyIconHast = fromHtml(copyIconCode, { fragment: true })
			copyIconHast.children[0].properties.class = 'w-5 h-5'
			const buttonNode = h('div', {
				class: 'absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200'
			}, [
				h('div', {
					class: 'tooltip tooltip-left',
					'data-tip': copyText,
				}, [
					h('button', {
						class: 'btn btn-ghost btn-square btn-sm text-icon w-5 h-5',
						onclick: `(async () => {
							const tooltip = this.parentElement
							const originalTip = tooltip.getAttribute('data-tip')
							try {
								await navigator.clipboard.writeText(${JSON.stringify(rawCode)})
								tooltip.setAttribute('data-tip', '${copiedText}')
								this.innerHTML = ${JSON.stringify(successIconCode)}
								this.querySelector('svg').classList.add('w-5', 'h-5')
							} catch (e) {
								alert('Failed to copy: ' + e.message)
							}
							setTimeout(() => {
								tooltip.setAttribute('data-tip', originalTip)
								this.innerHTML = ${JSON.stringify(copyIconCode)}
								this.querySelector('svg').classList.add('w-5', 'h-5')
							}, 2000)
						})()`,
					}, [
						copyIconHast
					])
				])
			])

			return h('div', { class: 'group', style: 'position: relative;' }, [
				hast,
				buttonNode
			])
		}
	}
}

async function GetConvertor({ isStandalone = false } = {}) {
	return unified()
		.use(remarkParse)
		.use(remarkDisable, { disable: ['codeIndented'] })
		.use(remarkBreaks)
		.use(remarkMath)
		.use(remarkRehype, {
			allowDangerousHtml: true,
		})
		.use(remarkGfm, {
			singleTilde: false,
		})
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
				isStandalone ?
					await SimpleShikiCopyButtonPlugin({
						copyText: geti18n('copy_button.copy.dataset.tip'),
						copiedText: geti18n('copy_button.copied.dataset.tip')
					}) :
					ShikiCopyButtonPlugin
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

document.head.prepend(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css' }))
const markdown_style = document.createElement('link')
markdown_style.rel = 'stylesheet'
onThemeChange((theme, is_dark) => {
	if (is_dark)
		markdown_style.href = 'https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-dark.min.css'
	else
		markdown_style.href = 'https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-light.min.css'
})
markdown_style.crossorigin = 'anonymous'
document.head.prepend(markdown_style) // 最低优先级以免覆写颜色设定
