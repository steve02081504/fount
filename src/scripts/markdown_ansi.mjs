import { Chalk } from 'npm:chalk'
import { highlight, supportsLanguage } from 'npm:cli-highlight'
import { markedTerminal } from 'npm:marked-terminal@^7'
import { Marked } from 'npm:marked@^13'
import stripAnsi from 'npm:strip-ansi'

/**
 * 为远端终端渲染 Markdown；颜色由客户端决定，而非后台服务器的 TTY。
 * @param {string} markdown Markdown 原文。
 * @param {{width?: number, ansi?: boolean}} [options] 终端显示选项。
 * @returns {string} 可直接显示的终端文本。
 */
export function renderMarkdownAnsi(markdown, { width = 80, ansi = true } = {}) {
	width = Number.isFinite(width) ? Math.max(20, Math.min(500, Math.floor(width))) : 80
	// chalk level 0 关闭主题着色；表格依赖仍可能输出 ANSI 复位序列。
	const chalk = new Chalk({ level: ansi ? 1 : 0 })
	const parser = new Marked(markedTerminal({
		width,
		reflowText: true,
		strong: chalk.bold,
		em: chalk.italic,
		codespan: chalk.yellow,
		heading: chalk.green.bold,
		firstHeading: chalk.magenta.bold,
		blockquote: chalk.gray.italic,
		link: chalk.blue,
		href: chalk.blue.underline,
		del: chalk.dim.strikethrough,
		tableOptions: { style: { head: [], border: [] } },
	}))
	// marked-terminal 在模块级 chalk.level 为 0 时直接跳过代码高亮，因此这里自带高亮与主题，保证后台进程也能输出颜色。
	parser.use({ renderer: {
		/**
		 * 渲染代码块并保留换行与缩进。
		 * @param {string} code 代码原文。
		 * @param {string} [language] fenced code 语言。
		 * @returns {string} 高亮后的代码块。
		 */
		code(code, language) {
			language = language?.split(/\s/)[0]
			let text = code
			try {
				if (language && supportsLanguage(language)) text = highlight(code, { language, ignoreIllegals: true, theme: {
					keyword: chalk.blue, built_in: chalk.cyan, type: chalk.cyan,
					literal: chalk.blue, number: chalk.green, string: chalk.red,
					comment: chalk.gray, title: chalk.yellow, attr: chalk.cyan,
					/**
					 * 保留未着色的代码片段。
					 * @param {string} value 原文。
					 * @returns {string} 原文。
					 */
					default: value => value,
				} })
			} catch { /* 未知语言保持原文。 */ }
			return '\n' + text.split('\n').map(line => '  ' + line).join('\n') + '\n\n'
		},
	} })
	const result = parser.parse(markdown)
	return ansi ? result : stripAnsi(result)
}
