/**
 * ZL-31 工具轮回归：chat shell 不提供 `finishRound` 时，工具调用后 regen 循环仍应继续下一轮生成。
 *
 * 回归背景：regen 循环曾写作 `if (!await args.generation_options.finishRound?.()) break`，
 * 而 `finishRound` 仅由 code shell 提供；chat shell 下 `undefined` 取反为 true，导致首个工具调用后即中断。
 * 现由 `finishToolRound` 统一收尾：缺省或返回非 false 继续，仅明确返回 false 才停止。
 * 本用例用两阶段 mock AI 源驱动 ZL-31 的 `get-tool-info` 工具，验证第 2 轮确实执行且工具结果已回灌。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assert } from 'jsr:@std/assert'

import { ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'
import { __dirname } from 'fount/server/base.mjs'

import { createIntegrationBoot } from '../harness.mjs'

/** mock AI 源目录名。 */
const AI_SOURCE_NAME = 'mock_tool_round'

/**
 * 播种两阶段 mock 工具轮 serviceSource。
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedToolRoundSource(dataDir, username) {
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

Deno.test('ZL-31 GetReply continues after a tool round without a shell finishRound', async () => {
	const username = `tool-round-${crypto.randomUUID().slice(0, 8)}`
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
			await seedToolRoundSource(dataDir, user)
		},
	})

	await boot.ensureServer()
	const char = await loadZl31FromTemplate(username)
	const stub = makePromptStub()

	const reply = await char.interfaces.chat.GetReply({
		char_id: 'ZL-31',
		Charname: 'ZL-31',
		username,
		chat_id: `zl31-tool-round-${username}`,
		UserCharname: 'Tester',
		UserUid: 'user',
		CharUid: 'char',
		char,
		user: stub,
		world: stub,
		other_chars: {},
		other_personas: {},
		plugins: {},
		chat_log: [
			{
				id: 'u1',
				name: 'Tester',
				uid: 'user',
				role: 'user',
				content: '请调用工具：<get-tool-info>persona-generator</get-tool-info>',
			},
		],
		timelines: [],
		locales: ['zh-CN'],
		chat_scoped_char_memory: {},
	})

	const content = String(reply?.content || '')
	assert(
		content.includes('MOCK_ROUND_DONE'),
		`工具轮后应继续第 2 轮生成并返回 MOCK_ROUND_DONE，实际 content=${JSON.stringify(content)}；` +
		'若此处只停在首轮工具调用，说明 regen 循环在缺少 finishRound 时被提前 break。',
	)
	assert(
		(reply?.logContextBefore?.length ?? 0) > 0,
		'工具结果应写入 reply.logContextBefore，证明本轮工具日志已回灌给角色。',
	)
	assert(
		!content.includes('<get-tool-info>'),
		`最终 content 不应残留未处理的工具标签，实际 content=${JSON.stringify(content)}。`,
	)
})
