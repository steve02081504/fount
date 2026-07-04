/**
 * 联邦发现 / room bootstrap 单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { parseFedBootstrapRequest } from '../../src/chat/federation/bootstrap/wire.mjs'
import { peekPreferredRoomOverride, setFederationBootstrap, clearFederationBootstrap } from '../../src/chat/federation/bootstrapStore.mjs'
import { roomCredentialsFromGroupSettings } from '../../src/chat/federation/roomCredentials.mjs'

const TEST_USER = '__fed_core_user__'

Deno.test('room bootstrap override wins over stale dag creds', () => {
	clearFederationBootstrap(TEST_USER, 'g1')
	setFederationBootstrap(TEST_USER, 'g1', { roomSecret: 'new-secret' })
	const dag = roomCredentialsFromGroupSettings({ roomSecret: 'old-secret' })
	const override = peekPreferredRoomOverride(TEST_USER, 'g1')
	assertEquals(override?.roomSecret, 'new-secret')
	assertEquals(dag?.roomSecret, 'old-secret')
	clearFederationBootstrap(TEST_USER, 'g1')
})

Deno.test('parseFedBootstrapRequest rejects invalid wire', () => {
	assertEquals(parseFedBootstrapRequest(null), null)
	assertEquals(parseFedBootstrapRequest({ requestId: 'r1' }), null)
	const ok = parseFedBootstrapRequest({
		requestId: 'r1',
		nodeHash: 'n1',
		groupId: 'g1',
		requesterPubKeyHash: 'a'.repeat(64),
	})
	assertEquals(ok?.groupId, 'g1')
})

