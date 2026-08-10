/**
 * proxy + ZL-31：100 轮会话的 OpenAI prompt 缓存率（mock）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { createIntegrationBoot } from 'fount/public/parts/shells/chat/test/harness.mjs'
import { __dirname } from 'fount/server/base.mjs'
import { startOpenAIPromptCacheMock } from 'fount/scripts/test/fixtures/openai_prompt_cache_mock.mjs'
import { ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'

/** 会话轮数。 */
const ROUNDS = 100
/** 全会话累计缓存率下限（depth=10 时 system 会移位，约 83%）。 */
const MIN_CACHE_RATE = 0.83
/** mock AI 源目录名。 */
const AI_SOURCE_NAME = 'proxy_openai_mock'

/**
 * 播种 proxy→mock 的 serviceSource。
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedProxyMockSource(dataDir, username) {
	const from = join(__dirname, 'src/scripts/test/fixtures/serviceSources/AI', AI_SOURCE_NAME)
	const to = join(dataDir, 'users', username, 'serviceSources', 'AI', AI_SOURCE_NAME)
	await mkdir(join(dataDir, 'users', username, 'serviceSources', 'AI'), { recursive: true })
	await cp(from, to, { recursive: true })
}

/**
 * 从模板目录加载 ZL-31（相对 import 仅在模板路径下有效）。
 * @param {string} username 用户
 * @returns {Promise<object>} 角色实例
 */
async function loadZl31FromTemplate(username) {
	const mainPath = join(__dirname, 'default/templates/user/chars/ZL-31/main.mjs')
	const char = (await import(pathToFileURL(mainPath).href)).default
	await char.Load({ username })
	await char.interfaces.config.SetData({
		AIsource: AI_SOURCE_NAME,
		plugins: [],
	})
	return char
}

/**
 * 空 world/user stub。
 * @returns {{ interfaces: { chat: { GetPrompt: () => Promise<object> } } }} stub
 */
function makePromptStub() {
	return {
		interfaces: {
			chat: {
				/**
				 * @returns {Promise<object>} 空 prompt
				 */
				GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
			},
		},
	}
}

Deno.test(`proxy + ZL-31 ${ROUNDS} rounds prompt cache rate >= ${MIN_CACHE_RATE * 100}%`, async () => {
	const mock = await startOpenAIPromptCacheMock()
	process.env.FOUNT_TEST_OPENAI_MOCK_URL = mock.completionsUrl

	const username = `proxy-cache-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = ensureSharedTestDataDir()
	const boot = createIntegrationBoot({
		username,
		p2p: false,
		minP2pNode: true,
		loadParts: [],
		/**
		 * @param {string} user 用户
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			await seedProxyMockSource(dataDir, user)
		},
	})

	try {
		await boot.ensureServer()
		const char = await loadZl31FromTemplate(username)
		const stub = makePromptStub()
		/** @type {object[]} */
		const chat_log = []

		for (let round = 0; round < ROUNDS; round++) {
			const userId = `user-${round}`
			chat_log.push({
				id: userId,
				name: 'Tester',
				uid: 'user',
				role: 'user',
				content: `第 ${round + 1} 轮：请简短确认你收到了这条消息。`,
			})

			const reply = await char.interfaces.chat.GetReply({
				char_id: 'ZL-31',
				Charname: 'ZL-31',
				UserCharname: 'Tester',
				UserUid: 'user',
				CharUid: 'char',
				char,
				user: stub,
				world: stub,
				other_chars: {},
				other_personas: {},
				plugins: {},
				chat_log,
				timelines: [],
				locales: ['zh-CN'],
				chat_scoped_char_memory: {},
			})

			const text = String(reply?.content || '')
			assert(text.includes('mock-ok:'), `round ${round} unexpected reply: ${text}`)
			chat_log.push({
				id: `char-${round}`,
				name: 'ZL-31',
				uid: 'char',
				role: 'char',
				content: text,
			})
		}

		const summary = mock.stats()
		assertEquals(summary.requests, ROUNDS)
		assert(
			summary.prefixMatchRate >= MIN_CACHE_RATE,
			`prefix match cache rate ${summary.prefixMatchRate} < ${MIN_CACHE_RATE} (prefixMatch=${summary.prefixMatchTokens} / prompt=${summary.promptTokens}; openaiFlooredRate=${summary.cacheRate})`,
		)
	}
	finally {
		delete process.env.FOUNT_TEST_OPENAI_MOCK_URL
		await mock.close()
	}
})
