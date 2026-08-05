/**
 * Risu 导入器 → loadPart → GetGreeting / GetPrompt / GetReply（mock AI）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildCCv3JsonBuffer, buildCCv3PngCard } from '../cards.mjs'
import { createImportBoot, importAndRunChar } from '../harness.mjs'

Deno.test('Risu CCv3 JSON import runs greeting, prompt, and mock AI reply', async () => {
	const username = `risu-json-${crypto.randomUUID().slice(0, 8)}`
	const boot = createImportBoot({ username })
	await boot.ensureServer()

	const result = await importAndRunChar({
		username,
		cardBuffer: buildCCv3JsonBuffer(),
		handler: 'Risu',
		expectedCharName: 'RisuImportTest',
		userMessage: 'ping from Risu JSON test',
		greetingMatch: 'Greetings Tester, this is RisuImportTest from Risu.',
	})

	assertEquals(result.partpath, 'chars/RisuImportTest')
	assertEquals(result.reply.content.includes('MOCK_OK|desc=1|user=ping from Risu JSON test'), true)
})

Deno.test('Risu CCv3 PNG import runs greeting, prompt, and mock AI reply', async () => {
	const username = `risu-png-${crypto.randomUUID().slice(0, 8)}`
	const boot = createImportBoot({ username })
	await boot.ensureServer()

	const result = await importAndRunChar({
		username,
		cardBuffer: buildCCv3PngCard({ name: 'RisuPngImportTest' }),
		handler: 'Risu',
		expectedCharName: 'RisuPngImportTest',
		userMessage: 'ping from Risu PNG test',
		greetingMatch: 'Greetings Tester, this is RisuPngImportTest from Risu.',
	})

	assertEquals(result.partpath, 'chars/RisuPngImportTest')
	assertEquals(result.reply.content.includes('MOCK_OK|desc=1|user=ping from Risu PNG test'), true)
})
