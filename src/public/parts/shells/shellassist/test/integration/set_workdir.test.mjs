/**
 * shellassist 默认接口契约：身份在每次请求时读取，`<set-workdir>` 依赖可就地 mutate 的 workdir 对象，
 * 且写入的记忆要在下次调用沿用。复刻 runReplyHandlers 的浅拷贝语义以暴露「改到副本上」的缺陷。
 */
/* global Deno */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

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

Deno.test('shellassist 工厂每次请求重新读取角色身份', async () => {
	await ensureServer()
	const { GetDefaultShellAssistInterface } = await import('../../src/default_interface/main.mjs')
	let identity
	const requests = []
	const char = {
		info: { 'zh-CN': { name: 'Deferred Char' } },
		interfaces: { chat: {
			/**
			 * @param {object} request 回复请求。
			 * @returns {Promise<{ content: string }>} 回复。
			 */
			GetReply: async request => {
				requests.push([request.username, request.char_id])
				return { content: 'ok' }
			},
		} },
	}
	// 身份可能晚于工厂调用才就位：工厂返回的 Assist 每次请求都重新读取它。
	char.interfaces.shellassist = GetDefaultShellAssistInterface(char, {
		/** @returns {{ username: string, charname: string }} 当前角色身份。 */
		getIdentity: () => identity,
	})
	const data = { UserCharname: 'User', shellhistory: [], shelltype: 'bash', pwd: '/', command_now: 'pwd', rejected_commands: [] }
	const assist = char.interfaces.shellassist.Assist
	identity = { username, charname: 'deferred-char' }
	await assist(data)
	identity = { username, charname: 'updated-char' }
	await assist(data)
	assertEquals(requests, [[username, 'deferred-char'], [username, 'updated-char']])
})

Deno.test('shellassist factory preserves character extensions and awaits result hooks without leaking request state', async () => {
	await ensureServer()
	const { GetDefaultShellAssistInterface } = await import('../../src/default_interface/main.mjs')
	const requestExtension = { source_purpose: 'shell-assist' }
	const observed = []
	const requests = []
	let reply = { content: 'ok', extension: { recommend_command: 'echo 42' } }
	const char = {
		info: { 'zh-CN': { name: 'Factory Char' } },
		interfaces: { chat: {
			/**
			 * @param {object} request 回复请求。
			 * @returns {Promise<object | null>} 回复。
			 */
			GetReply: async request => {
				assertEquals(request.extension.source_purpose, 'shell-assist')
				assertEquals(request.username, username)
				assertEquals(request.char_id, 'factory-char')
				requests.push(request)
				request.extension.source_purpose = 'changed-by-char'
				return reply
			},
		} },
	}
	const assist = GetDefaultShellAssistInterface(char, {
		/** @returns {{ username: string, charname: string }} 当前角色身份。 */
		getIdentity: () => ({ username, charname: 'factory-char' }),
		requestExtension,
		/**
		 * @param {object} args 终端请求。
		 * @param {object | null} result 回复。
		 * @returns {Promise<void>} 统计完成。
		 */
		onResult: async (args, result) => {
			await Promise.resolve()
			observed.push([args.command_now, result])
		},
	})
	const data = { username: 'untrusted-override', UserCharname: 'User', shellhistory: [], shelltype: 'bash', pwd: '/', command_now: 'echo 42', rejected_commands: [] }
	const first = await assist.Assist(data)
	assertEquals(first.recommend_command, 'echo 42', '支持只返回 extension 的角色')
	assertEquals(observed, [['echo 42', reply]])
	assertEquals(requestExtension, { source_purpose: 'shell-assist' })
	reply = null
	assertEquals(await assist.Assist(data), undefined)
	assertEquals(observed[1], ['echo 42', null], '无回复时仍记录用户活动')
	assertEquals(requests[0].chat_id === requests[1].chat_id, false)
	/**
	 * 模拟生成异常。
	 * @returns {Promise<never>} 拒绝生成。
	 */
	char.interfaces.chat.GetReply = async () => { throw new Error('generation failed') }
	await assertRejects(() => assist.Assist(data), Error, 'generation failed')
	assertEquals(observed.length, 2, '生成异常时不调用结果钩子')
})

Deno.test('shellassist recommendation handler exposes commands to IPC and removes tags from display', async () => {
	await ensureServer()
	const { recommendCommandReplyHandler } = await import('../../src/default_interface/recommend_command.mjs')
	const { runReplyHandlers } = await import('../../../chat/src/reply/handlerPipeline.mjs')
	const result = { content: 'Try this:\n<recommend_command>echo 42</recommend_command>', extension: {}, files: [], logContextBefore: [] }
	await runReplyHandlers(result, {
		Charname: 'Tester', CharUid: 'char', UserUid: 'user', char_id: 'tester', locales: [],
		supported_functions: { markdown: true }, prompt_struct: { chat_log: [] }, extension: {},
	}, [recommendCommandReplyHandler])
	assertEquals(result.recommend_command, 'echo 42')
	assertEquals(result.extension.recommend_command, 'echo 42')
	assertEquals(result.content_for_show.includes('<recommend_command>'), false)
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
	const assist = GetDefaultShellAssistInterface(char_API, {
		/** @returns {{ username: string, charname: string }} 当前角色身份。 */
		getIdentity: () => ({ username, charname: 'test-char' }),
	})
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
