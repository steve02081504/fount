/**
 * easynew easyworld 创建 → loadPart → GetGreeting / GetPrompt。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createEasynewBoot, createFromTemplate, makePromptStub, PROMPT_MARKER } from '../harness.mjs'

Deno.test('easynew easyworld create runs greeting and GetPrompt', async () => {
	const username = `easy-world-${crypto.randomUUID().slice(0, 8)}`
	const boot = createEasynewBoot({ username })
	await boot.ensureServer()

	const worldName = 'EasyWorldTest'
	const created = await createFromTemplate('easyworld', {
		username,
		formData: {
			name: worldName,
			description: 'easynew world test',
			prompt: `${PROMPT_MARKER} The world is a quiet testing ground for \${user.name}.`,
			greeting: 'Welcome ${user.name} to ${char.name}\'s world.',
			author: 'fount-test',
			version: '1.0.0',
			tags: 'test',
		},
		files: {},
	})
	assertEquals(created, worldName)

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const world = await loadPart(username, `worlds/${worldName}`)
	const stub = makePromptStub()
	const args = {
		Charname: 'EasyWorldTest',
		UserCharname: 'Tester',
		char: stub,
		user: stub,
		world,
		other_chars: {},
		plugins: {},
		chat_log: [],
		locales: ['en-UK'],
	}

	const greeting = await world.interfaces.chat.GetGreeting(args, 0)
	assertEquals(String(greeting?.content || '').includes('Welcome Tester to EasyWorldTest\'s world.'), true)

	const prompt = await world.interfaces.chat.GetPrompt(args)
	const blob = JSON.stringify(prompt)
	assertEquals(blob.includes(PROMPT_MARKER), true)
	assertEquals(blob.includes('Tester'), true)
})
