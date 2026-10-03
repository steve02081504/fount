/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { buildPromptStruct, structPromptToSingleNoChatLog } from '../../src/prompt_struct/index.mjs'

/**
 * 按声明的渲染能力构建提示结构。
 * @param {object} supported_functions shell 能力
 * @returns {Promise<object>} 提示结构
 */
async function guideFor(supported_functions) {
	return await buildPromptStruct({
		char_id: 'char', Charname: 'Char', CharUid: 'char', UserCharname: 'User', UserUid: 'user',
		char: null, user: null, world: null, other_chars: {}, other_personas: {}, plugins: {},
		chat_log: [], timelines: [], locales: ['zh-CN'], extension: {}, supported_functions,
	})
}

Deno.test('chat/code 的网页能力注入一份交互式输出指南', async () => {
	const prompt = await guideFor({ markdown: true, mathjax: true, html: true, unsafe_html: true, files: true, add_message: true, fount_themes: true })
	assertEquals(prompt.world_prompt.text, [])
	assert(prompt.output_guide.includes('fount.user.send'))
	assert(prompt.output_guide.includes('临时文件'))
	assert(prompt.output_guide.includes('Mermaid'))
	assert(prompt.output_guide.includes('showLineNumbers'))
	assert(prompt.output_guide.includes('TailwindCSS'))
	assert(structPromptToSingleNoChatLog(prompt).includes('Output environment and rendering:'))
})

Deno.test('HTML、JavaScript、发送消息和主题样式按各自能力提示', async () => {
	const html = (await guideFor({ markdown: true, html: true, add_message: true })).output_guide
	assert(html.includes('可以使用 HTML'))
	assert(!html.includes('JavaScript'))
	assert(!html.includes('fount.user.send'))
	assert(!html.includes('TailwindCSS'))

	const scripted = (await guideFor({ markdown: true, unsafe_html: true })).output_guide
	assert(scripted.includes('JavaScript'))
	assert(!scripted.includes('fount.user.send'))
	assert(!scripted.includes('TailwindCSS'))

	const interactive = (await guideFor({ markdown: true, unsafe_html: true, add_message: true })).output_guide
	assert(interactive.includes('fount.user.send'))
	assert(interactive.includes('onclick'))
	assert(!interactive.includes('TailwindCSS'))

	const themed = (await guideFor({ markdown: true, fount_themes: true })).output_guide
	assert(themed.includes('TailwindCSS'))
	assert(!themed.includes('JavaScript'))
})

Deno.test('social 的纯 Markdown 回复不宣称 HTML 或数学能力', async () => {
	const prompt = await guideFor({ markdown: true, mathjax: false, html: false, unsafe_html: false })
	assert(!prompt.output_guide.includes('fount.user.send'))
	assert(!prompt.output_guide.includes('KaTeX'))
	assert(prompt.output_guide.includes('Mermaid'))
})

Deno.test('非 Markdown 输出只说明纯文本限制，不宣称任何渲染能力', async () => {
	const prompt = await guideFor({ markdown: false })
	assertEquals(prompt.output_guide, '当前回复会以纯文本显示，不要使用 Markdown、HTML、Mermaid 图表或数学公式。\n')
})
