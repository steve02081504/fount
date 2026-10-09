/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import { AIOutputDegenerationError, createOutputGuard, createRepetitionDetector } from '../../src/outputGuard.mjs'
import { OUTPUT_RECOVERY_PROMPT, recoveryMessages } from '../../src/outputRecovery.mjs'

Deno.test('repetition detection is independent of transport chunk size, including large chunks', () => {
	for (const text of ['泥水'.repeat(200) + '恢复正常', '好吃太'.repeat(200), '在\n\n的，Linux 是\n\n存\n\n'.repeat(80), '这是一个较长的分析段落，需要重新阅读图片中的结构并再次确认同一项假设。'.repeat(15)]) {
		let expected
		for (const size of [1, 7, 32, 117, text.length]) {
			const detector = createRepetitionDetector()
			let evidence
			for (let offset = 0; offset < text.length && !evidence; offset += size) evidence = detector.append(text.slice(offset, offset + size))
			evidence ??= detector.finish()
			assertEquals(evidence?.kind, 'periodic')
			expected ??= evidence
			assertEquals(evidence, expected)
		}
	}
})

Deno.test('numbered lists compare item bodies without erasing semantic numbers', () => {
	const repeated = Array.from({ length: 20 }, (_, i) => `• 第${208 + i}把：毛瑟 Kar98k（德国），同一种步枪型号\n`).join('')
	for (const size of [1, 13, repeated.length]) {
		const detector = createRepetitionDetector()
		let evidence
		for (let offset = 0; offset < repeated.length && !evidence; offset += size) evidence = detector.append(repeated.slice(offset, offset + size))
		assertEquals(evidence?.kind, 'numbered_items')
	}
	const detector = createRepetitionDetector()
	assertEquals(detector.append(Array.from({ length: 200 }, (_, i) => `${i + 1}. 这一项的测量值为 ${i * 17 + 3}，采集时间为 ${2000 + i} 年。\n`).join('')), undefined)
	assertEquals(detector.finish(), undefined)
})

Deno.test('ordinary text, short repetition, code and varying tables stay usable', () => {
	for (const text of [
		'好的，好的。我们回到原问题。',
		'泥水'.repeat(20),
		Array.from({ length: 150 }, (_, i) => `const value${i} = ${i * i}; // case ${i}\n`).join(''),
		Array.from({ length: 150 }, (_, i) => `| ${i} | ${i + 15} | ${i * 37} |\n`).join(''),
	]) {
		const detector = createRepetitionDetector()
		assertEquals(detector.append(text), undefined)
		assertEquals(detector.finish(), undefined)
	}
})

Deno.test('reasoning and answer channels have independent repetition budgets', () => {
	const guard = createOutputGuard()
	guard.inspect({ content: '泥水'.repeat(24), extension: { reasoning_content: '泥水'.repeat(24), reasoning_summary: ['泥水'.repeat(24)] } }, true)
	const error = assertThrows(() => guard.inspect({ content: '正常回答', extension: { reasoning_content: '泥水'.repeat(80) } }), AIOutputDegenerationError)
	assertEquals(error.evidence.channel, 'reasoning')
})

Deno.test('correction preserves original messages, attachments, role policy and trailing prefill', () => {
	const prefill = { role: 'assistant', content: '<message "id">\n<sender>Char</sender>\n<content>\n' }
	const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] }, prefill]
	const retry = recoveryMessages(messages, {})
	assertEquals(retry, [messages[0], { role: 'system', content: OUTPUT_RECOVERY_PROMPT }, prefill])
	assertEquals(messages.length, 2)
	const restricted = recoveryMessages([messages[0]], { convert_config: { forceNoSystemMessages: true, forceRoleAlternation: true, forceUserMessageEnding: true } })
	assertEquals(restricted.map(message => message.role), ['user', 'assistant', 'user'])
	assertEquals(restricted.at(-1).content, 'system: ' + OUTPUT_RECOVERY_PROMPT)
})
