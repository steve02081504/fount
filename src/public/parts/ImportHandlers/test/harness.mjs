/**
 * ImportHandler 集成测试共用 harness。
 */
import { createIntegrationBoot } from 'fount/public/parts/shells/chat/test/harness.mjs'
import { MOCK_AI_NAME, PROMPT_MARKER, seedMockAiSource } from 'fount/scripts/test/fixtures/mock_ai.mjs'
import { ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'

/** 再导出 mock AI 名称与提示标记。 */
export { MOCK_AI_NAME, PROMPT_MARKER }

/**
 * 启动已播种 mock AI 的进程内服务器。
 * @param {object} [options] createIntegrationBoot options
 * @param {string} [options.username] test username
 * @param {(username: string) => Promise<void>} [options.afterInit] extra afterInit
 * @returns {ReturnType<typeof createIntegrationBoot>} boot handle
 */
export function createImportBoot(options = {}) {
	const dataDir = ensureSharedTestDataDir()
	return createIntegrationBoot({
		minP2pNode: false,
		loadParts: [],
		...options,
		/**
		 * @param {string} username username
		 * @returns {Promise<void>}
		 */
		afterInit: async username => {
			await seedMockAiSource(dataDir, username)
			if (options.afterInit) await options.afterInit(username)
		},
	})
}

/**
 * 供 buildPromptStruct 使用的空 world/user stub。
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
 * 导入角色卡、挂上 mock AI，并跑通 greeting / prompt / reply。
 * @param {object} options run options
 * @param {string} options.username fount username
 * @param {Buffer} options.cardBuffer card bytes
 * @param {'SillyTavern' | 'Risu'} options.handler which ImportHandler to load
 * @param {string} options.expectedCharName expected dirname / display name
 * @param {string} options.userMessage user chat line for GetReply
 * @param {RegExp | string} options.greetingMatch greeting content assert
 * @returns {Promise<{partpath: string, greeting: object, prompt: object, reply: object}>} results
 */
export async function importAndRunChar(options) {
	const {
		username,
		cardBuffer,
		handler,
		expectedCharName,
		userMessage,
		greetingMatch,
	} = options

	const handlerModule = await import(`fount/public/parts/ImportHandlers/${handler}/main.mjs`)
	const [partpath] = await handlerModule.default.interfaces.import.ImportAsData(username, cardBuffer)
	if (!partpath?.startsWith('chars/'))
		throw new Error(`unexpected partpath: ${partpath}`)
	const charName = partpath.slice('chars/'.length)
	if (charName !== expectedCharName)
		throw new Error(`expected char ${expectedCharName}, got ${charName}`)

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const char = await loadPart(username, partpath)
	await char.interfaces.config.SetData({ AIsource: MOCK_AI_NAME })

	const greetingArgs = {
		UserCharname: 'Tester',
		locales: ['en-UK'],
		chat_log: [],
		chat_scoped_char_memory: {},
	}
	const greeting = await char.interfaces.chat.GetGreeting(greetingArgs, 0)
	const greetingText = String(greeting?.content || '')
	if (typeof greetingMatch === 'string' ? !greetingText.includes(greetingMatch) : !greetingMatch.test(greetingText))
		throw new Error(`greeting mismatch: ${greetingText}`)

	const promptStub = makePromptStub()
	const requestBase = {
		char_id: charName,
		Charname: charName,
		UserCharname: 'Tester',
		UserUid: 'user',
		CharUid: 'char',
		char,
		user: promptStub,
		world: promptStub,
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
	const promptBlob = JSON.stringify(prompt)
	if (!promptBlob.includes(PROMPT_MARKER))
		throw new Error(`GetPrompt missing ${PROMPT_MARKER}`)

	const reply = await char.interfaces.chat.GetReply(requestBase)
	const replyText = String(reply?.content || '')
	if (!replyText.startsWith('MOCK_OK|desc=1|'))
		throw new Error(`GetReply did not use mock AI / prompt marker: ${replyText}`)
	if (!replyText.includes(`user=${userMessage}`))
		throw new Error(`GetReply missing user message: ${replyText}`)

	return { partpath, greeting, prompt, reply }
}
