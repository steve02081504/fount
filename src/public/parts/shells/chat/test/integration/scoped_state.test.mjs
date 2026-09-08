/**
 * 频道级 scoped-state 持久化测试：同一频道并发保存 memory 与 workdir 时经串行队列原子读改写，
 * 两字段都保留、互不覆盖；损坏的频道状态文件不被空态整体覆盖（读取时仅 ENOENT 返回空态）。
 */
/* global Deno */
import { writeFile, rm } from 'node:fs/promises'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({ username: 'scoped-state-user' })

const groupId = 'scoped-group'
const channelId = 'scoped-channel'
const charname = 'scoped-char'

Deno.test('并发保存 memory 与 workdir 后两字段都保留', async () => {
	await ensureServer()
	const { getScopedCharState, saveScopedMemory, saveScopedWorkdir } = await import('../../src/chat/session/scopedState.mjs')
	const memory = { workspace: { value: 1 } }
	const workdir = { machine: '2', path: '/remote/ws' }
	await Promise.all([
		saveScopedMemory(username, groupId, channelId, charname, memory),
		saveScopedWorkdir(username, groupId, channelId, charname, workdir),
	])
	const state = await getScopedCharState(username, groupId, channelId, charname)
	assert(state.memory, 'memory 应被持久化')
	assert(state.workdir, 'workdir 应被持久化')
	assertEquals(state.memory.workspace.value, 1)
	assertEquals(state.workdir.machine, '2')
	assertEquals(state.workdir.path, '/remote/ws')
})

Deno.test('saveScopedState 一次同时写入 memory 与 workdir', async () => {
	const { getScopedCharState, saveScopedState } = await import('../../src/chat/session/scopedState.mjs')
	await saveScopedState(username, groupId, channelId, charname, {
		memory: { a: 1 },
		workdir: { machine: '0', path: '/local/ws' },
	})
	const state = await getScopedCharState(username, groupId, channelId, charname)
	assertEquals(state.memory.a, 1)
	assertEquals(state.workdir.machine, '0')
})

Deno.test('损坏的频道状态文件读取时抛错而非返回空态', async () => {
	const { scopedStatePath } = await import('../../src/chat/lib/paths.mjs')
	const path = scopedStatePath(username, groupId, channelId)
	await writeFile(path, '{ not valid json', 'utf8')
	const { getScopedCharState } = await import('../../src/chat/session/scopedState.mjs')
	let threw = false
	try {
		await getScopedCharState(username, groupId, channelId, charname)
	}
	catch {
		threw = true
	}
	assert(threw, '损坏文件应抛错')
})

Deno.test('缺失文件视为空态（首次使用）', async () => {
	const missingId = 'missing-channel'
	const { scopedStatePath } = await import('../../src/chat/lib/paths.mjs')
	await rm(scopedStatePath(username, groupId, missingId), { force: true })
	const { getScopedCharState } = await import('../../src/chat/session/scopedState.mjs')
	const state = await getScopedCharState(username, groupId, missingId, charname)
	assert(state)
	assertEquals(Object.keys(state.memory), [])
})

Deno.test('持久化 workdir 存在但非法时读取抛错而非返回缺省', async () => {
	const { scopedStatePath } = await import('../../src/chat/lib/paths.mjs')
	const path = scopedStatePath(username, groupId, channelId)
	await writeFile(path, JSON.stringify({ [charname]: { workdir: 'not-an-object' } }), 'utf8')
	const { getScopedCharState } = await import('../../src/chat/session/scopedState.mjs')
	let threw = false
	try {
		await getScopedCharState(username, groupId, channelId, charname)
	}
	catch {
		threw = true
	}
	assert(threw, '非法 workdir 应抛错')
})
