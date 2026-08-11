/**
 * materializeGroupSettings：缺省 / 非法 / 零值 maxDagPayloadBytes 回落默认。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { DEFAULT_GROUP_SETTINGS, materializeGroupSettings } from '../../src/chat/dag/groupSettings.mjs'

Deno.test('materializeGroupSettings fills defaults and coerces maxDagPayloadBytes', () => {
	assertEquals(materializeGroupSettings({}).maxDagPayloadBytes, DEFAULT_GROUP_SETTINGS.maxDagPayloadBytes)
	assertEquals(materializeGroupSettings({ maxDagPayloadBytes: 0 }).maxDagPayloadBytes, DEFAULT_GROUP_SETTINGS.maxDagPayloadBytes)
	assertEquals(materializeGroupSettings({ maxDagPayloadBytes: 'nope' }).maxDagPayloadBytes, DEFAULT_GROUP_SETTINGS.maxDagPayloadBytes)
	assertEquals(materializeGroupSettings({ maxDagPayloadBytes: 512_000 }).maxDagPayloadBytes, 512_000)
	assertEquals(materializeGroupSettings({ joinPolicy: 'open' }).joinPolicy, 'open')
})
