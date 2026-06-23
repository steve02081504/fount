/**
 * HLC skew 策略单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { classifyHlcSkewAction } from '../../src/chat/events/hlcPolicy.mjs'

const HLC_TEST_MAX_SKEW_MS = 60_000
const HLC_FUTURE_WALL = Date.now() + HLC_TEST_MAX_SKEW_MS * 10

Deno.test('classifyHlcSkewAction rejects federated channel_create with large future HLC', () => {
	assertEquals(
		classifyHlcSkewAction(
			{ type: 'channel_create', hlc: { wall: HLC_FUTURE_WALL } },
			HLC_TEST_MAX_SKEW_MS,
			{ source: 'federation' },
		),
		'reject',
	)
})

Deno.test('classifyHlcSkewAction quarantines federated message with large future HLC', () => {
	assertEquals(
		classifyHlcSkewAction(
			{ type: 'message', hlc: { wall: HLC_FUTURE_WALL } },
			HLC_TEST_MAX_SKEW_MS,
			{ source: 'federation' },
		),
		'quarantine',
	)
})

Deno.test('classifyHlcSkewAction allows small future drift within skew window', () => {
	assertEquals(
		classifyHlcSkewAction(
			{ type: 'channel_create', hlc: { wall: Date.now() + 1000 } },
			HLC_TEST_MAX_SKEW_MS,
			{ source: 'federation' },
		),
		'allow',
	)
})

Deno.test('classifyHlcSkewAction rejects federated session event with future HLC', () => {
	assertEquals(
		classifyHlcSkewAction(
			{ type: 'session_world_bind', hlc: { wall: HLC_FUTURE_WALL } },
			HLC_TEST_MAX_SKEW_MS,
			{ source: 'federation' },
		),
		'reject',
	)
})
