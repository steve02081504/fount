/**
 * easynew easychar 创建 → loadPart → GetGreeting / GetPrompt / GetReply（mock AI）。
 */
/* global Deno */
import { seedMockAiSource } from 'fount/scripts/test/fixtures/mock_ai.mjs'
import { assertEquals } from 'jsr:@std/assert'

import { createEasynewBoot, createFromTemplate, MOCK_AI_NAME, PROMPT_MARKER, runEasyChar } from '../harness.mjs'

/**
 * 用最小表单创建一个 easychar。
 * @param {string} username 测试用户
 * @param {string} charName 角色名
 * @returns {Promise<string>} 创建出的角色名
 */
function createTestChar(username, charName) {
	return createFromTemplate('easychar', {
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
}

Deno.test('easynew easychar create runs greeting, prompt, and mock AI reply', async () => {
	const username = `easy-char-${crypto.randomUUID().slice(0, 8)}`
	const boot = createEasynewBoot({ username })
	await boot.ensureServer()

	const charName = 'EasyCharTest'
	assertEquals(await createTestChar(username, charName), charName)

	const result = await runEasyChar({
		username,
		charName,
		userMessage: 'ping from easynew char',
		greetingMatch: 'Hello Tester, I am EasyCharTest.',
	})
	assertEquals(result.reply.content.includes('MOCK_OK|desc=1|user=ping from easynew char'), true)
})

Deno.test('easynew easychar loadPart SetData binds preferred AI source', async () => {
	const username = `easy-char-pref-${crypto.randomUUID().slice(0, 8)}`
	const boot = createEasynewBoot({ username })
	await boot.ensureServer()

	const charName = 'EasyCharPref'
	assertEquals(await createTestChar(username, charName), charName)

	const { getAnyPreferredDefaultPart, loadAnyPreferredDefaultPart, loadPart } = await import('fount/server/parts_loader.mjs')
	assertEquals(getAnyPreferredDefaultPart(username, 'serviceSources/AI'), MOCK_AI_NAME)
	assertEquals((await loadAnyPreferredDefaultPart(username, 'serviceSources/AI'))?.filename, MOCK_AI_NAME)

	const char = await loadPart(username, `chars/${charName}`)
	assertEquals((await char.interfaces.config.GetData()).AIsource, MOCK_AI_NAME)
})

Deno.test('getAnyPreferredDefaultPart falls back by username when user record is missing', async () => {
	const registered = `easy-char-reg-${crypto.randomUUID().slice(0, 8)}`
	const boot = createEasynewBoot({ username: registered })
	const { dataDir } = await boot.ensureServer()

	const ghost = `easy-char-ghost-${crypto.randomUUID().slice(0, 8)}`
	await seedMockAiSource(dataDir, ghost)

	const { getAnyPreferredDefaultPart, loadAnyPreferredDefaultPart } = await import('fount/server/parts_loader.mjs')
	assertEquals(getAnyPreferredDefaultPart(ghost, 'serviceSources/AI'), MOCK_AI_NAME)
	assertEquals((await loadAnyPreferredDefaultPart(ghost, 'serviceSources/AI'))?.filename, MOCK_AI_NAME)
})
