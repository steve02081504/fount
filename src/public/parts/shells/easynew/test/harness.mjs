/**
 * easynew 创建 → 加载 → 运行集成测试共用 harness。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createIntegrationBoot } from 'fount/public/parts/shells/chat/test/harness.mjs'
import { MOCK_AI_NAME, PROMPT_MARKER, seedMockAiSource } from 'fount/scripts/test/fixtures/mock_ai.mjs'
import { ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'

/** 再导出 mock AI 名称与提示标记。 */
export { MOCK_AI_NAME, PROMPT_MARKER }

/**
 * 启动已播种 mock AI 的进程内服务器。
 * @param {object} [options] createIntegrationBoot options
 * @returns {ReturnType<typeof createIntegrationBoot>} boot handle
 */
export function createEasynewBoot(options = {}) {
	const { afterInit: userAfter, ...rest } = options
	const dataDir = ensureSharedTestDataDir()
	return createIntegrationBoot({
		loadParts: [],
		...rest,
		p2p: false,
		minP2pNode: true,
		/**
		 * @param {string} user username
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			await seedMockAiSource(dataDir, user)
			if (userAfter) await userAfter(user)
		},
	})
}

/**
 * 供 buildPromptStruct 使用的空 world/user/char stub。
 * @returns {{interfaces: {chat: {GetPrompt: () => Promise<object>}}}} stub part
 */
export function makePromptStub() {
	return {
		interfaces: {
			chat: {
				/**
				 * @returns {Promise<object>} empty prompt slice
				 */
				GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
			},
		},
	}
}

/**
 * 用表单数据调用 easynew 模板的 New()。
 * @param {string} templateName easychar | easypersona | easyworld
 * @param {object} context New() context without templateDir
 * @returns {Promise<string>} created part name
 */
export async function createFromTemplate(templateName, context) {
	return (await import(`fount/public/parts/shells/easynew/parts/${templateName}/main.mjs`)).New({
		...context,
		templateDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'parts', templateName),
	})
}

/**
 * 断言新创建的 easychar 能经 mock AI 完成 greeting / prompt / reply。
 * @param {object} options run options
 * @param {string} options.username fount username
 * @param {string} options.charName created char name
 * @param {string} options.userMessage user chat line
 * @param {string} options.greetingMatch expected greeting substring
 * @returns {Promise<{greeting: object, prompt: object, reply: object}>} results
 */
export async function runEasyChar(options) {
	const { username, charName, userMessage, greetingMatch } = options
	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const char = await loadPart(username, `chars/${charName}`)
	await char.interfaces.config.SetData({ AIsource: MOCK_AI_NAME })

	const greeting = await char.interfaces.chat.GetGreeting({
		Charname: charName,
		UserCharname: 'Tester',
		locales: ['en-UK'],
		chat_log: [],
		chat_scoped_char_memory: {},
	}, 0)
	const greetingText = String(greeting.content)
	if (!greetingText.includes(greetingMatch))
		throw new Error(`greeting mismatch: ${greetingText}`)

	const stub = makePromptStub()
	const requestBase = {
		char_id: charName,
		Charname: charName,
		UserCharname: 'Tester',
		UserUid: 'user',
		CharUid: 'char',
		char,
		user: stub,
		world: stub,
		other_chars: {},
		other_personas: {},
		plugins: {},
		chat_log: [{
			name: 'Tester',
			uid: 'user',
			role: 'user',
			content: userMessage,
		}],
		timelines: [],
		locales: ['en-UK'],
		chat_scoped_char_memory: {},
	}

	const prompt = await char.interfaces.chat.GetPrompt(requestBase)
	if (!JSON.stringify(prompt).includes(PROMPT_MARKER))
		throw new Error(`GetPrompt missing ${PROMPT_MARKER}`)

	const reply = await char.interfaces.chat.GetReply(requestBase)
	const replyText = String(reply.content)
	if (!replyText.startsWith('MOCK_OK|desc=1|'))
		throw new Error(`GetReply did not use mock AI / prompt marker: ${replyText}`)
	if (!replyText.includes(`user=${userMessage}`))
		throw new Error(`GetReply missing user message: ${replyText}`)

	return { greeting, prompt, reply }
}
