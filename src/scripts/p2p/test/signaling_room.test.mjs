/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	DEFAULT_RELAY_URLS,
	buildTrysteroSignalingConfig,
	mergeSignalingRelayUrls,
} from '../signaling_room.mjs'

Deno.test('mergeSignalingRelayUrls deduplicates and preserves order', () => {
	const merged = mergeSignalingRelayUrls(['wss://relay.damus.io', 'wss://custom.example'])
	assertEquals(merged.includes('wss://relay.damus.io'), true)
	assertEquals(merged.includes('wss://custom.example'), true)
	assertEquals(new Set(merged).size, merged.length)
})

Deno.test('mergeSignalingRelayUrls falls back to DEFAULT_RELAY_URLS', () => {
	const merged = mergeSignalingRelayUrls([])
	assertEquals(merged.length >= DEFAULT_RELAY_URLS.length, true)
})

Deno.test('buildTrysteroSignalingConfig includes relay urls', () => {
	const cfg = buildTrysteroSignalingConfig({
		appId: 'test-app',
		password: 'secret',
		relayUrls: ['wss://relay.example'],
	})
	assertEquals(cfg.appId, 'test-app')
	assertEquals(cfg.password, 'secret')
	assertEquals(cfg.relayConfig.urls.includes('wss://relay.example'), true)
})
