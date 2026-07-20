/**
 * agent 从 char part info 同步到联邦 profile（多语言 + 头像）。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR = 'on_message_yes'

Deno.test('ensureLocalAgentEntityHash syncs part info into localized profile', async () => {
	const username = `sync-char-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const from = join(fixturesRoot, 'chars', CHAR)
			const to = join(dataDir, 'users', user, 'chars', CHAR)
			await mkdir(dirname(to), { recursive: true })
			await cp(from, to, { recursive: true })
		},
	})
	await ensureServer()

	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getProfile } = await import('../../src/entity/profile.mjs')
	const { syncAgentProfileFromCharPart } = await import('../../src/profile/syncFromCharPart.mjs')

	const entityHash = await ensureLocalAgentEntityHash(username, CHAR)
	const profile = await getProfile(entityHash, username, { locales: ['zh-CN'] })
	assertEquals(profile.charPartName, CHAR)
	assertEquals(profile.name, 'OnMessage Yes')
	assertEquals(profile.avatar, '🟢')
	assertEquals(profile.tags, ['test'])
	assertEquals(profile.description, 'OnMessage probe')
	assertEquals(!!profile.localized?.['zh-CN']?.avatar, true)

	// force rebuild still works after manual wipe
	await (await import('../../src/entity/profile.mjs')).updateProfile(username, entityHash, {
		localized: { 'zh-CN': { name: 'changed' } },
	}, { skipPresentation: true })
	await syncAgentProfileFromCharPart(username, entityHash, { force: true })
	const rebuilt = await getProfile(entityHash, username, { locales: ['zh-CN'] })
	assertEquals(rebuilt.name, 'OnMessage Yes')
	assertEquals(rebuilt.avatar, '🟢')
})

Deno.test('loadPart during blank-profile sync does not deadlock (Load→ensure→sync)', async () => {
	const username = `sync-load-${crypto.randomUUID().slice(0, 8)}`
	const CHAR_LOAD = 'gentian_shell_contract'
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const from = join(fixturesRoot, 'chars', CHAR_LOAD)
			const to = join(dataDir, 'users', user, 'chars', CHAR_LOAD)
			await mkdir(dirname(to), { recursive: true })
			await cp(from, to, { recursive: true })
		},
	})
	await ensureServer()

	const { loadPart } = await import('../../../../../../server/parts_loader.mjs')
	// fixture Load → initTriggerIdentity → ensureLocalAgentEntityHash → sync（profile 尚空）
	const part = await Promise.race([
		loadPart(username, `chars/${CHAR_LOAD}`),
		new Promise((_, reject) => setTimeout(() => reject(new Error('loadPart deadlock timeout')), 15000)),
	])
	assertEquals(!!part?.interfaces?.chat?.OnMessage, true)
})

Deno.test('/parts/... avatar resolves under public/ and backfills missing avatar', async () => {
	const username = `sync-avif-${crypto.randomUUID().slice(0, 8)}`
	const CHAR = 'part_avatar_public'
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const from = join(fixturesRoot, 'chars', CHAR)
			const to = join(dataDir, 'users', user, 'chars', CHAR)
			await mkdir(dirname(to), { recursive: true })
			await cp(from, to, { recursive: true })
		},
	})
	await ensureServer()

	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getProfile, updateProfile } = await import('../../src/entity/profile.mjs')
	const { syncAgentProfileFromCharPart } = await import('../../src/profile/syncFromCharPart.mjs')

	const entityHash = await ensureLocalAgentEntityHash(username, CHAR)
	const profile = await getProfile(entityHash, username, { locales: ['zh-CN'] })
	assertEquals(profile.name, 'Public Avatar Char')
	assertEquals(profile.avatar.includes('/files/profile/avatar'), true)
	assertEquals(profile.tags, ['avatar-sync'])

	// 模拟旧 bug：有文案无头像 → ensure 路径应补传
	await updateProfile(username, entityHash, {
		localized: { 'zh-CN': { name: 'Public Avatar Char', tags: ['avatar-sync'] } },
	}, { skipPresentation: true })
	const wiped = await getProfile(entityHash, username, { locales: ['zh-CN'], skipPresentation: true })
	assertEquals(!!String(wiped.localized?.['zh-CN']?.avatar || '').trim(), false)

	await syncAgentProfileFromCharPart(username, entityHash, { force: false })
	const backfilled = await getProfile(entityHash, username, { locales: ['zh-CN'] })
	assertEquals(backfilled.avatar.includes('/files/profile/avatar'), true)
	assertEquals(backfilled.name, 'Public Avatar Char')
})
