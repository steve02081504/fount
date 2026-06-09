/**
 * 联邦发现 / MQTT bootstrap 单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { parseFedBootstrapRequest } from '../src/chat/federation/bootstrap/wire.mjs'
import { peekPreferredMqttOverride, setFederationBootstrap, clearFederationBootstrap } from '../src/chat/federation/bootstrapStore.mjs'
import { mqttCredentialsFromGroupSettings } from '../src/chat/federation/mqttCredentials.mjs'
import { markMqttCredentialsStale, isMqttCredentialsStale } from '../src/chat/federation/mqttStale.mjs'

const TEST_USER = '__fed_test_user__'

Deno.test('mqtt bootstrap override when stale', () => {
	clearFederationBootstrap(TEST_USER, 'g1')
	setFederationBootstrap(TEST_USER, 'g1', { mqttRoomSecret: 'new-secret' })
	markMqttCredentialsStale(TEST_USER, 'g1')
	assertEquals(isMqttCredentialsStale(TEST_USER, 'g1'), true)
	const dag = mqttCredentialsFromGroupSettings({ mqttRoomSecret: 'old-secret' })
	const override = peekPreferredMqttOverride(TEST_USER, 'g1')
	assertEquals(override?.mqttRoomSecret, 'new-secret')
	assertEquals(dag?.mqttRoomSecret, 'old-secret')
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

