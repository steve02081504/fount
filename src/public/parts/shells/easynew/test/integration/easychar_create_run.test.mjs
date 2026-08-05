/**
 * easynew easychar 创建 → loadPart → GetGreeting / GetPrompt / GetReply（mock AI）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createEasynewBoot, createFromTemplate, PROMPT_MARKER, runEasyChar } from '../harness.mjs'

Deno.test('easynew easychar create runs greeting, prompt, and mock AI reply', async () => {
	const username = `easy-char-${crypto.randomUUID().slice(0, 8)}`
	const boot = createEasynewBoot({ username })
	await boot.ensureServer()

	const charName = 'EasyCharTest'
	const created = await createFromTemplate('easychar', {
		username,
		formData: {
			name: charName,
			description: 'easynew char test',
			first_mes: 'Hello ${user.name}, I am ${char.name}.',
			personality: `${PROMPT_MARKER} curious tester personality`,
			scenario: 'integration test room',
			mes_example: '',
			author: 'fount-test',
			version: '1.0.0',
			tags: 'test,easynew',
		},
		files: {},
	})
	assertEquals(created, charName)

	const result = await runEasyChar({
		username,
		charName,
		userMessage: 'ping from easynew char',
		greetingMatch: 'Hello Tester, I am EasyCharTest.',
	})
	assertEquals(result.reply.content.includes('MOCK_OK|desc=1|user=ping from easynew char'), true)
})
