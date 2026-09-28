/**
 * chat `<set-workdir>` 持久化：首轮设置后应写入频道 scoped state，下一次请求沿用同一工作目录。
 */
/* global Deno */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { createCharBoot, waitUntil } from '../harness.mjs'

const CHAR = 'set_workdir_agent'

/**
 * 归一化路径分隔符，便于跨平台比较。
 * @param {unknown} value - 原始路径。
 * @returns {string} 以 `/` 分隔的路径。
 */
function normalizePath(value) {
	return String(value ?? '').replace(/\\/g, '/')
}

Deno.test('chat <set-workdir> persists to scoped state and the next request', async () => {
	const username = `swd-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { getScopedCharState } = await import('../../src/chat/session/scopedState.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')

	const root = await mkdtemp(join(tmpdir(), 'fount_chat_setworkdir_'))
	await writeFile(join(root, 'note.txt'), 'SUB NOTE', 'utf8')
	process.env.FOUNT_TEST_SET_WORKDIR_TARGET = root
	try {
		const groupId = await newGroup(username, { name: 'set-workdir' })
		const channelId = await getDefaultChannelId(username, groupId)
		await addchar(groupId, CHAR, username)

		await postChannelMessage(username, groupId, channelId, { text: '开始' })
		await waitUntil(async () => (await getScopedCharState(username, groupId, channelId, CHAR)).workdir?.path, 20000, 100)

		const state = await getScopedCharState(username, groupId, channelId, CHAR)
		assertEquals(normalizePath(state.workdir.path), normalizePath(root), `scoped state 应持久化 workdir：${JSON.stringify(state.workdir)}`)

		// 下一次请求必须沿用持久化的工作目录（修复前 request.workdir 恒为 undefined，set-workdir 形同虚设）
		const request = await getChatRequest(groupId, CHAR, channelId)
		assertEquals(normalizePath(request.workdir?.path), normalizePath(root), `下一次请求应沿用持久化 workdir：${JSON.stringify(request.workdir)}`)
	}
	finally {
		delete process.env.FOUNT_TEST_SET_WORKDIR_TARGET
		await rm(root, { recursive: true, force: true })
	}
})
