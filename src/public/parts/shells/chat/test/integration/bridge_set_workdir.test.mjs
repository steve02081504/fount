/**
 * 虚拟桥接（平台 bot）`<set-workdir>` 持久化：应写入虚拟会话记忆，并在下一次请求沿用。
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

Deno.test('virtual bridge <set-workdir> persists in session memory and the next request', async () => {
	const username = `bswd-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { buildVirtualBridgeChatRequest } = await import('../../src/chat/bridge/request.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const charAPI = await loadPart(username, `chars/${CHAR}`)

	const root = await mkdtemp(join(tmpdir(), 'fount_bridge_setworkdir_'))
	await writeFile(join(root, 'note.txt'), 'SUB NOTE', 'utf8')
	process.env.FOUNT_TEST_SET_WORKDIR_TARGET = root
	try {
		let groupId = ''
		await bridgeIngestDto(username, charAPI, 'telegram', {
			platform: 'telegram',
			platformChatId: 'bswd-1',
			chatKind: 'group',
			platformMessageId: 1,
			author: { platformUserId: 'tg-user', displayName: 'TG User' },
			text: '开始',
			timestamp: Date.now(),
		}, async gid => {
			groupId = gid
			registerBridgeOutbound(username, gid, async () => ({ platformMessageId: 2 }))
		}, 'tg-bot', CHAR)

		await waitUntil(() => getVirtualBridgeSession(username, groupId)?.charMemories?.[CHAR]?.workdir?.path, 20000, 100)

		const workdir = getVirtualBridgeSession(username, groupId).charMemories[CHAR].workdir
		assertEquals(normalizePath(workdir.path), normalizePath(root), `虚拟会话应持久化 workdir：${JSON.stringify(workdir)}`)

		const rebuilt = await buildVirtualBridgeChatRequest(username, groupId, 'default', CHAR, charAPI, null)
		assertEquals(normalizePath(rebuilt.workdir?.path), normalizePath(root), `下一次请求应沿用持久化 workdir：${JSON.stringify(rebuilt.workdir)}`)
	}
	finally {
		delete process.env.FOUNT_TEST_SET_WORKDIR_TARGET
		await rm(root, { recursive: true, force: true })
	}
})
