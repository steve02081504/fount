/**
 * Discord Owner 平台 id 解析纯测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { resolveOwnerPlatformUserId } from '../../src/ownerResolve.mjs'

Deno.test('resolveOwnerPlatformUserId: OwnerUserID skips guild scan', async () => {
	let guildScanned = false
	async function fetchUser(id) {
		assertEquals(id, '123456789012345678')
		return { globalName: 'Snowflake Owner', username: 'snow_owner' }
	}
	function listGuilds() {
		guildScanned = true
		return [].values()
	}
	const client = {
		users: { fetch: fetchUser },
		guilds: { cache: { values: listGuilds } },
	}

	const owner = await resolveOwnerPlatformUserId(client, {
		OwnerUserID: '123456789012345678',
		OwnerUserName: 'ignored_username',
	})
	assert(owner)
	assertEquals(owner.platformUserId, '123456789012345678')
	assertEquals(owner.displayName, 'Snowflake Owner')
	assertEquals(guildScanned, false)
})

Deno.test('resolveOwnerPlatformUserId: OwnerUserName guild member scan', async () => {
	const mockMember = {
		id: '987654321098765432',
		displayName: 'Guild Nick',
		user: { username: 'owner_user', globalName: 'Owner Global' },
	}
	async function rejectFetch() {
		throw new Error('users.fetch should not run')
	}
	async function fetchMembers() {
		return { find: predicate => [mockMember].find(predicate) }
	}
	function listGuilds() {
		return [{ id: 'guild-1', members: { fetch: fetchMembers } }].values()
	}
	const client = {
		users: { fetch: rejectFetch },
		guilds: { cache: { values: listGuilds } },
	}

	const owner = await resolveOwnerPlatformUserId(client, { OwnerUserName: 'owner_user' })
	assert(owner)
	assertEquals(owner.platformUserId, '987654321098765432')
	assertEquals(owner.displayName, 'Guild Nick')
})
