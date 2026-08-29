/**
 * profile 联邦传播：revalidate 语义、广播发送与接收端注册。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession({
	minP2pNode: true,
})

/**
 * 构造一个非本机 nodeHash 前缀的远端实体 hash。
 * @returns {string} 128 hex
 */
function remoteEntityHash() {
	const subject = crypto.randomUUID().replaceAll('-', '')
	return `${'b'.repeat(64)}${subject}${subject}`
}

/**
 * 编码远端 profile 明文（注入 readPlain 须返回 Buffer，与 readPublicFile 返回类型一致）。
 * @param {string} fresh JSON 明文
 * @returns {Buffer} UTF-8 字节
 */
function freshBytes(fresh) {
	return Buffer.from(fresh)
}

Deno.test('updateProfile publishes and fires profile_update notification without breaking', async () => {
	const { username } = await getSession()
	const { resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')
	const { getProfile, updateProfile } = await import('../../src/entity/profile.mjs')

	const operator = await resolveOperatorEntityHashForUser(username)
	assert(operator)

	const updated = await updateProfile(username, operator, {
		localized: { 'zh-CN': { name: '通知用户' } },
	}, { skipPresentation: true })
	assertEquals(updated.localized['zh-CN'].name, '通知用户')

	const reread = await getProfile(operator, username, { skipPresentation: true })
	assertEquals(reread.localized['zh-CN'].name, '通知用户')
})

Deno.test('fetchAndCacheRemoteProfile revalidate bypasses negative cache and refetches', async () => {
	const { username } = await getSession()
	const { fetchAndCacheRemoteProfile, getProfile } = await import('../../src/entity/profile.mjs')

	const remoteHash = remoteEntityHash()
	const fresh = JSON.stringify({ entityHash: remoteHash, handle: 'revalidated-peer' })

	// 首次拉取失败 → 进入 60s 负缓存
	const first = await fetchAndCacheRemoteProfile(username, remoteHash, {
		timeoutMs: 300,
		readPlain: /** @returns {Promise<null>} 模拟拉取失败 */ async () => null,
	})
	assertEquals(first, null)

	// 负缓存命中时（无 revalidate）直接跳过，不触发读取
	let called = false
	const second = await fetchAndCacheRemoteProfile(username, remoteHash, {
		timeoutMs: 300,
		readPlain: /** @returns {Promise<Buffer>} 注入的新 profile 明文 */ async () => {
			called = true
			return freshBytes(fresh)
		},
	})
	assertEquals(called, false)
	assertEquals(second, null)

	// revalidate: true 跳过负缓存并重新拉取落盘
	called = false
	const third = await fetchAndCacheRemoteProfile(username, remoteHash, {
		timeoutMs: 300,
		readPlain: /** @returns {Promise<Buffer>} 注入的新 profile 明文 */ async () => {
			called = true
			return freshBytes(fresh)
		},
		revalidate: true,
	})
	assert(called, 'revalidate must refetch despite negative cache')
	assert(third, 'revalidate must return the fresh remote profile')
	assertEquals(third.handle, 'revalidated-peer')

	const onDisk = await getProfile(remoteHash, username, { skipPresentation: true })
	assertEquals(onDisk.handle, 'revalidated-peer')
})

Deno.test('profile_update handler registers and unregisters idempotently', async () => {
	const {
		registerChatProfileUpdateHandler,
		unregisterChatProfileUpdateHandler,
	} = await import('../../src/entity/profileFederation.mjs')

	registerChatProfileUpdateHandler()
	registerChatProfileUpdateHandler()
	unregisterChatProfileUpdateHandler()
	unregisterChatProfileUpdateHandler()
})