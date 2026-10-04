/**
 * shellassist 默认接口的 `<set-workdir>` 支撑：请求必须传入可就地 mutate 的 workdir 对象，
 * 且写入的记忆要在下次调用沿用。复刻 runReplyHandlers 的浅拷贝语义以暴露「改到副本上」的缺陷。
 */
/* global Deno */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { createTestServerBoot, ensureSharedTestDataDir } from 'fount/scripts/test/node/boot.mjs'

import { seedStubCharPart } from '../../../chat/test/harness.mjs'

const username = 'shellassist-workdir-user'
const ensureServer = createTestServerBoot({
	username,
	dataDir: ensureSharedTestDataDir(),
	minP2pNode: false,
	p2p: false,
	loadParts: ['shells/shellassist'],
})

Deno.test('shellassist 单次 IPC 返回 ANSI 显示文本并保留原始内容', async () => {
	const { dataDir } = await ensureServer()
	const charname = 'terminal-render-stub'
	await seedStubCharPart(dataDir, username, charname)
	await writeFile(join(dataDir, 'users', username, 'chars', charname, 'main.mjs'), `export default {
		interfaces: { shellassist: { Assist: async data => ({
			content: data.command_now,
			content_for_show: data.command_output,
			chat_scoped_char_memory: data.chat_scoped_char_memory,
		}) } }
	}`)
	const { processIPCCommand } = await import('../../../../../../server/ipc_server/index.mjs')
	/**
	 * 通过正式部件 IPC 请求辅助回复。
	 * @param {object} data 辅助请求。
	 * @returns {Promise<object>} IPC 响应。
	 */
	const invoke = data => processIPCCommand('invokepart', { username, partpath: 'shells/shellassist', data: { charname, ...data } })
	const reply = await invoke({ command_now: 'raw <tag>', command_output: '**terminal**' })
	assertEquals(reply.status, 'ok')
	assertEquals(reply.data.content, 'raw <tag>')
	assertEquals(reply.data.content_for_show.includes('\x1b[1mterminal\x1b[22m'), true)
	assertEquals((await invoke({ command_now: '**fallback**', ansi: false })).data.content_for_show, 'fallback\n\n')
	assertEquals((await invoke({ command_now: 'hidden', command_output: '' })).data.content_for_show, '')
})

Deno.test('shellassist 默认接口传入可变 workdir 并在记忆中延续', async () => {
	await ensureServer()
	const { GetDefaultShellAssistInterface } = await import('../../src/default_interface/main.mjs')

	/** @type {object | null} */
	let captured = null
	const char_API = {
		info: { 'zh-CN': { name: 'Test Char' } },
		interfaces: {
			chat: {
				/**
				 * 模拟真实模型：处理器在浅拷贝上改 workdir（与 runReplyHandlers 一致）。
				 * @param {object} args - 聊天回复请求。
				 * @returns {Promise<object>} 回复。
				 */
				GetReply: async args => {
					captured = args
					const handlerArgs = { ...args }
					const workdir = handlerArgs.workdir ??= {}
					workdir.machine = '0'
					workdir.path = '/target'
					handlerArgs.chat_scoped_char_memory.workdir = { ...workdir }
					return { content: 'ok' }
				},
			},
		},
	}
	const assist = GetDefaultShellAssistInterface(char_API, username, 'test-char')
	const data = {
		username,
		UserCharname: 'User',
		shelltype: 'bash',
		shellhistory: [],
		pwd: '/',
		screen: '',
		command_now: 'ls',
		command_output: '',
		command_error: '',
		rejected_commands: [],
		chat_scoped_char_memory: {},
	}

	const first = await assist.Assist(data)
	assertEquals(captured.username, username, '回复请求必须带上部件加载所需的操作用户')
	assertEquals(captured.supported_functions.markdown, true, '终端支持 Markdown 渲染')
	assertEquals(captured.workdir?.path, '/target', '请求应提供可被就地 mutate 的 workdir 对象')
	assertEquals(first.chat_scoped_char_memory.workdir.path, '/target', 'workdir 应写入并随记忆返回')

	await assist.Assist({ ...data, chat_scoped_char_memory: first.chat_scoped_char_memory })
	assertEquals(captured.workdir?.path, '/target', '再次调用应沿用记忆里的 workdir')
})
