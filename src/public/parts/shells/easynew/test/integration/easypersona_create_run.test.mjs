/**
 * easynew easypersona 创建 → loadPart → GetPrompt。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createEasynewBoot, createFromTemplate, makePromptStub, PROMPT_MARKER } from '../harness.mjs'

Deno.test('easynew easypersona create runs GetPrompt', async () => {
	const username = `easy-persona-${crypto.randomUUID().slice(0, 8)}`
	const boot = createEasynewBoot({ username })
	await boot.ensureServer()

	const personaName = 'EasyPersonaTest'
	const created = await createFromTemplate('easypersona', {
		username,
		formData: {
			name: personaName,
			description: 'easynew persona test',
			user_name: 'TesterAlias',
			appearance: 'wearing a test badge',
			personality: `${PROMPT_MARKER} calm and precise`,
			author: 'fount-test',
			version: '1.0.0',
			tags: 'test',
		},
		files: {},
	})
	assertEquals(created, personaName)

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const persona = await loadPart(username, `personas/${personaName}`)
	const stub = makePromptStub()
	const prompt = await persona.interfaces.chat.GetPrompt({
		Charname: 'SomeChar',
		UserCharname: 'Tester',
		char: stub,
		user: persona,
		world: stub,
		other_chars: {},
		plugins: {},
		chat_log: [],
		locales: ['en-UK'],
	})
	const blob = JSON.stringify(prompt)
	assertEquals(blob.includes('TesterAlias'), true)
	assertEquals(blob.includes(PROMPT_MARKER), true)
	assertEquals(blob.includes('wearing a test badge'), true)
})
