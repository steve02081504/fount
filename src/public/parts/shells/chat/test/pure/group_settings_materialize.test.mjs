/**
 * materializeGroupSettings 合并默认；非法 maxDagPayloadBytes 由入站校验拒绝。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import {
	DEFAULT_GROUP_SETTINGS,
	materializeGroupSettings,
	validateGroupSettingsUpdateContent,
} from '../../src/chat/dag/groupSettings.mjs'

Deno.test('materializeGroupSettings merges defaults without coercing maxDagPayloadBytes', () => {
	assertEquals(materializeGroupSettings({}).maxDagPayloadBytes, DEFAULT_GROUP_SETTINGS.maxDagPayloadBytes)
	assertEquals(materializeGroupSettings({ maxDagPayloadBytes: 512_000 }).maxDagPayloadBytes, 512_000)
	assertEquals(materializeGroupSettings({ joinPolicy: 'open' }).joinPolicy, 'open')
})

Deno.test('validateGroupSettingsUpdateContent rejects invalid maxDagPayloadBytes', () => {
	assertThrows(
		() => validateGroupSettingsUpdateContent({ maxDagPayloadBytes: 0 }),
		Error,
		'invalid maxDagPayloadBytes',
	)
	assertThrows(
		() => validateGroupSettingsUpdateContent({ maxDagPayloadBytes: 'nope' }),
		Error,
		'invalid maxDagPayloadBytes',
	)
	validateGroupSettingsUpdateContent({ maxDagPayloadBytes: 512_000 })
	validateGroupSettingsUpdateContent({})
})
