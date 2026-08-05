/**
 * SillyTavern 导入器 → loadPart → GetGreeting / GetPrompt / GetReply（mock AI）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildStPngCard } from '../cards.mjs'
import { createImportBoot, importAndRunChar } from '../harness.mjs'

Deno.test('SillyTavern PNG import runs greeting, prompt, and mock AI reply', async () => {
	const username = `st-import-${crypto.randomUUID().slice(0, 8)}`
	await createImportBoot({ username }).ensureServer()

	const result = await importAndRunChar({
		username,
		cardBuffer: buildStPngCard(),
		handler: 'SillyTavern',
		expectedCharName: 'STImportTest',
		userMessage: 'ping from ST test',
		greetingMatch: 'Hello Tester, I am STImportTest.',
	})

	assertEquals(result.partpath, 'chars/STImportTest')
	assertEquals(result.reply.content.includes('MOCK_OK|desc=1|user=ping from ST test'), true)
})
