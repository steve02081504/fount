/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import { assert, assertEquals } from 'jsr:@std/assert'

import { transcriptHtml } from '../../cli/export_html.mjs'

Deno.test('standalone HTML export renders markdown and neutralizes raw HTML', () => {
	const entries = [
		{ id: 'a', role: 'user', content: '> 请检查构建' },
		{ id: 'b', role: 'char', name: 'coder', content: '# 结果\n\n**加粗** 与 `code`\n\n<img src=x onerror=alert(1)>' },
		{ id: 'c', role: 'char', is_generating: true, content: '不该出现' },
		{ id: 'd', role: 'tool', name: 'run-js', content: 'done', files: [{ name: 'shot.png', mime_type: 'image/png', buffer: 'AAAA' }] },
	]
	const html = transcriptHtml(entries, { title: '会话 <x>', locale: 'zh-CN' })
	assert(html.startsWith('<!DOCTYPE html>'))
	assert(html.includes('<html lang="zh-CN">'))
	assert(html.includes('<title>会话 &lt;x&gt;</title>'))
	assert(html.includes('<h1>结果</h1>'))
	assert(html.includes('<strong>加粗</strong>'))
	assert(html.includes('<blockquote>'))
	assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
	assert(!html.includes('<img src=x'))
	assert(!html.includes('不该出现'))
	assert(html.includes('data:image/png;base64,AAAA'))
	assertEquals(html.split('</html>').length, 2)
})

Deno.test('standalone HTML export keeps empty transcripts valid', () => {
	const html = transcriptHtml([], { title: 'empty' })
	assert(html.includes('<title>empty</title>'))
	assert(!html.includes('<section'))
})
