/**
 * 具名实体搜索：本地 handle 命中、排序与无效 query。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession({
	minP2pNode: true,
})

Deno.test('normalizeEntityHandle accepts empty and valid ids', async () => {
	const { normalizeEntityHandle } = await import('../../src/entity/profile.mjs')
	assertEquals(normalizeEntityHandle(''), '')
	assertEquals(normalizeEntityHandle('  Steve_01  '), 'steve_01')
	let threw = false
	try {
		normalizeEntityHandle('A')
	}
	catch {
		threw = true
	}
	assert(threw)
})

Deno.test('searchEntitiesNetwork finds local handle without network peers', async () => {
	const { username } = await getSession()
	const { ensureOperatorPubKey, resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')
	const { updateProfile, getProfile } = await import('../../src/entity/profile.mjs')
	const {
		localEntitySearchHandler,
		registerChatEntitySearchHandler,
		searchEntitiesNetwork,
	} = await import('../../src/entity/entitySearch.mjs')
	const { resetPartQueryStateForTests } = await import(
		'npm:@steve02081504/fount-p2p/wire/part_query'
	)

	await ensureOperatorPubKey(username)
	const operator = await resolveOperatorEntityHashForUser(username)
	assert(operator)

	await updateProfile(username, operator, {
		handle: 'steve_test',
		localized: { 'zh-CN': { name: '史蒂夫' } },
	}, { skipPresentation: true })

	const profile = await getProfile(operator, username, { skipPresentation: true })
	assertEquals(profile.handle, 'steve_test')

	resetPartQueryStateForTests()
	registerChatEntitySearchHandler()

	const localRows = await localEntitySearchHandler({ replicaUsername: username }, { q: 'steve' })
	assert(localRows.some(row => row.entityHash === operator && row.handle === 'steve_test'))

	const { entities } = await searchEntitiesNetwork(username, 'steve', {
		viewerEntityHash: operator,
		maxHits: 10,
	})
	assert(entities.some(row => row.entityHash === operator))
	const hit = entities.find(row => row.entityHash === operator)
	assertEquals(hit.handle, 'steve_test')
	assertEquals(hit.name, '史蒂夫')
})

Deno.test('searchEntitiesNetwork returns empty for short query', async () => {
	const { username } = await getSession()
	const { searchEntitiesNetwork } = await import('../../src/entity/entitySearch.mjs')
	const result = await searchEntitiesNetwork(username, 'x')
	assertEquals(result.entities, [])
})
