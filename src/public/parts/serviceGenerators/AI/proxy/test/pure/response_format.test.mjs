/**
 * cleanupResponseText / clearFormat：剥离模型回显的 `<message><sender><content>` 信封标记。
 * 用例取自真实泄露会话（`.fount/code/sessions/191cc975.json`、`736cdcb2.json`）的形态。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { cleanupResponseText, clearFormat } from '../../src/responseFormat.mjs'

Deno.test('strips a full envelope and keeps only the body', () => {
	assertEquals(
		cleanupResponseText('<message "ab12">\n<sender>ZL-31</sender>\n<content>\nHello 世界\n</content>\n</message "ab12">'),
		'\nHello 世界\n',
	)
})

Deno.test('echoed context keeps only the last message body', () => {
	const text = [
		'<message "u1">',
		'<sender>user</sender>',
		'<content>',
		'Hi',
		'</content>',
		'</message "u1">',
		'<message "a1">',
		'<sender>ZL-31</sender>',
		'<content>',
		'Reply body',
		'</content>',
		'</message "a1">',
	].join('\n')
	assertEquals(cleanupResponseText(text), '\nReply body\n')
})

Deno.test('removes leaked "<message continuation>" markers and stray closing tags', () => {
	const text = '确认了。\n\n<run-js>\nconsole.log(1)\n</run-js>\n\n\n<message continuation>\n\n\n\n<message continuation></message>\n</content>'
	const cleaned = cleanupResponseText(text)
	assert(!cleaned.includes('<message'), cleaned)
	assert(!cleaned.includes('</content>'), cleaned)
	assert(cleaned.includes('<run-js>'), 'tool tag must be preserved')
	assert(cleaned.includes('console.log(1)'), 'tool body must be preserved')
})

Deno.test('removes repeated closing pairs', () => {
	const text = '正文\n</content>\n</message "74812004">\n\n</content>\n</message "4ebddb30">'
	assertEquals(cleanupResponseText(text), '正文\n')
})

Deno.test('removes a lone trailing closing tag', () => {
	const text = '交叉验证通过。\n\n<run-subagent>\n任务\n</run-subagent>\n\n\n</message>'
	assertEquals(cleanupResponseText(text), '交叉验证通过。\n\n<run-subagent>\n任务\n</run-subagent>\n\n')
})

Deno.test('removes an opener/closer wrapper without sender or content', () => {
	assertEquals(cleanupResponseText('<message "x">\nbody text\n</message "x">'), 'body text')
})

Deno.test('removes a standalone sender line', () => {
	assertEquals(cleanupResponseText('<sender>ZL-31</sender>\n实际正文'), '实际正文')
})

Deno.test('removes a lone trailing `</`', () => {
	assertEquals(cleanupResponseText('正文\n</'), '正文\n')
})

Deno.test('cleanupResponseText is idempotent', () => {
	const text = '<message "x">\n<sender>ZL-31</sender>\n<content>\n正文\n</content>\n</message "x">'
	const once = cleanupResponseText(text)
	assertEquals(cleanupResponseText(once), once)
})

Deno.test('non-string input is returned untouched', () => {
	assertEquals(cleanupResponseText(undefined), undefined)
	assertEquals(cleanupResponseText(null), null)
})

Deno.test('alternative_charnames boundary wins over other senders', () => {
	const text = [
		'<sender>user</sender>',
		'<content>',
		'用户正文',
		'</content>',
		'<sender>龙胆</sender>',
		'<content>',
		'角色正文',
		'</content>',
		'</message>',
	].join('\n')
	assertEquals(
		cleanupResponseText(text, { alternative_charnames: ['龙胆'] }),
		'\n角色正文\n',
	)
})

Deno.test('clearFormat cleans both content and content_for_show', () => {
	const res = clearFormat({
		content: '正文\n</message>',
		content_for_show: '<details>show</details>\n</content>',
	})
	assertEquals(res.content, '正文')
	assertEquals(res.content_for_show, '<details>show</details>')
})
