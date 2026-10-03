/**
 * chat、code、social 共用的网页输出说明。只描述当前请求声明的渲染能力。
 * @param {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t['supported_functions']} capabilities 请求声明的渲染能力
 * @returns {string} 输出指南
 */
export function webOutputGuide(capabilities) {
	if (!capabilities.markdown) return `\
当前回复会以纯文本显示，不要使用 Markdown、HTML、Mermaid 图表或数学公式。
`
	const lines = [
		'当前回复会在 fount 网页中显示。支持 GitHub Flavored Markdown、Mermaid 图表（使用 mermaid 代码围栏）；删除线用双波浪线，点击显示用双竖线。',
	]
	if (capabilities.mathjax) lines.push('数学公式使用 KaTeX；`$$` 与 `\\begin`、`\\end` 之间需要换行。')
	if (capabilities.html)
		lines.push('可以使用 HTML；需要渲染的 HTML 不要包在代码块中。Markdown、代码块、内联代码、图表和数学公式在 HTML 标签内不会生效，优先使用 Markdown。')

	if (capabilities.unsafe_html) lines.push(
		'可以在输出的 HTML 中使用 JavaScript。',
		`当用户请求可能需要多次修改的产物（如“给我一个计算器”），且你能操作文件时，优先将产物写进临时文件。${capabilities.files ? '若有可用的发送方式，可直接交付文件附件；' : ''}若有可用的 inline 工具，也可读取文件并直接输出。后续沿用同一文件，只修改需要变化的部分。`,
	)
	if (capabilities.fount_themes) lines.push('可以使用 TailwindCSS 和 daisyUI 类名。')
	if (capabilities.unsafe_html && capabilities.add_message) lines.push('可用 HTML 按钮让用户直接选择，例如 `<button class="btn" onclick="void fount.user.send(\'选择A\')">A</button>`；`fount.user.send` 接收 string 或 `{content, content_for_show?, files?}`。')
	lines.push('内联高亮可写作 `代码{:js}`。代码围栏支持 `js {1-3,6}#id` 标记高亮行、`js /console/3-5#id` 标记字符、`title="My Code" caption="Example"` 设置标题/字幕、`showLineNumbers` 或 `showLineNumbers{3}` 显示行号。')
	return lines.join('\n')
}
