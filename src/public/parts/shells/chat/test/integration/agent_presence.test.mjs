/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createCharBoot, seedStubCharPart } from '../harness.mjs'

Deno.test('local agent presence follows loaded lifecycle and custom chat.GetStatus', async () => {
	const username = `presence-${crypto.randomUUID().slice(0, 8)}`
	const charname = 'presence_agent'
	const boot = createCharBoot({
		username,
		/**
		 * @param {string} user 测试用户名
		 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			await seedStubCharPart(boot.dataDir, user, charname)
		},
	})
	await boot.ensureServer()
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getEffectiveStatus } = await import('../../src/entity/presence.mjs')
	const { loadPart, unloadPart, isPartLoaded } = await import('fount/server/parts_loader.mjs')
	const entityHash = await ensureLocalAgentEntityHash(username, charname)
	const profile = { entityHash, status: 'offline', lastSeenAt: 0 }
	const partpath = `chars/${charname}`
	assertEquals(await getEffectiveStatus(profile, username), 'offline')
	assertEquals(isPartLoaded(username, partpath), false)
	const part = await loadPart(username, partpath, { username })
	try {
		assertEquals(await getEffectiveStatus(profile, username), 'online')
		assertEquals(await getEffectiveStatus({ ...profile, status: 'dnd' }, username), 'dnd')
		part.chat = {
			/**
			 * @param {{ username: string, entityHash: string }} arg 角色身份
			 * @returns {Promise<string>} 状态
			 */
			GetStatus: async arg => {
				assertEquals(arg, { username, entityHash })
				return 'offline'
			},
		}
		assertEquals(await getEffectiveStatus({ ...profile, lastSeenAt: Date.now() }, username), 'offline')
		/**
		 * @returns {Promise<string>} 隐身
		 */
		part.chat.GetStatus = async () => 'invisible'
		assertEquals(await getEffectiveStatus(profile, username, entityHash), 'invisible')
		assertEquals(await getEffectiveStatus(profile, username, 'b'.repeat(128)), 'offline')
		/**
		 * @returns {Promise<undefined>} 使用心跳逻辑
		 */
		part.chat.GetStatus = async () => undefined
		assertEquals(await getEffectiveStatus(profile, username), 'offline')
	}
	finally {
		delete part.chat
		await unloadPart(username, partpath, { username })
	}
	assertEquals(await getEffectiveStatus(profile, username), 'offline')
})
