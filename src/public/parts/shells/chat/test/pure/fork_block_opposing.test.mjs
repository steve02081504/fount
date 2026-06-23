/**
 * fork/block-opposing 纯逻辑单测（Deno）。
 * 覆盖 computeOpposingForkBlockTargets：对立分叉分支上治理事件签发者/目标识别、自身排除、入参校验。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { computeOpposingForkBlockTargets } from '../../src/chat/governance/forkBlockOpposing.mjs'

/**
 * @param {string} label 短标签
 * @returns {string} 稳定的 64 位 hex id
 */
function hex64(label) {
	const base = label.replace(/[^0-9a-f]/giu, '').toLowerCase() || '0'
	return base.padEnd(64, '0').slice(0, 64)
}

const SELF = hex64('5e1f')
const ATTACKER = hex64('a77ac6e2')
const VICTIM = hex64('21c71')

/**
 * 构造「创世 → 自身消息支 / 对立治理支」分叉事件集。
 * @param {object} [opts] 覆盖项
 * @returns {{ events: object[], acceptedTip: string, opposingTip: string }} 事件集与两叶 id
 */
function buildForkEvents(opts = {}) {
	const genesis = { id: hex64('9e5'), prev_event_ids: [], type: 'group_meta_update', sender: SELF }
	const accepted = { id: hex64('acce97ed'), prev_event_ids: [genesis.id], type: 'message', sender: SELF, content: {} }
	const opposing = {
		id: hex64('0bb05ed'),
		prev_event_ids: [genesis.id],
		type: opts.opposingType ?? 'role_assign',
		sender: opts.opposingSender ?? ATTACKER,
		content: opts.opposingContent ?? { targetPubKeyHash: VICTIM },
	}
	return { events: [genesis, accepted, opposing], acceptedTip: accepted.id, opposingTip: opposing.id }
}

Deno.test('computeOpposingForkBlockTargets blocks opposing governance sender and target', () => {
	const { events, acceptedTip } = buildForkEvents()
	const blocked = computeOpposingForkBlockTargets(events, acceptedTip, SELF).sort()
	assertEquals(blocked, [ATTACKER, VICTIM].sort())
})

Deno.test('computeOpposingForkBlockTargets excludes self pubKeyHash', () => {
	const { events, acceptedTip } = buildForkEvents({ opposingSender: SELF, opposingContent: { targetPubKeyHash: VICTIM } })
	const blocked = computeOpposingForkBlockTargets(events, acceptedTip, SELF)
	assertEquals(blocked, [VICTIM])
})

Deno.test('computeOpposingForkBlockTargets ignores non-governance opposing events', () => {
	const { events, acceptedTip } = buildForkEvents({ opposingType: 'message', opposingContent: { targetPubKeyHash: VICTIM } })
	const blocked = computeOpposingForkBlockTargets(events, acceptedTip, SELF)
	assertEquals(blocked, [])
})

Deno.test('computeOpposingForkBlockTargets does not block shared ancestor governance senders', () => {
	const founder = hex64('f0unde7')
	// 共享创世治理事件由 founder 签发，是两支共同祖先，不应被拉黑。
	const genesis = { id: hex64('9e5'), prev_event_ids: [], type: 'role_create', sender: founder, content: {} }
	const accepted = { id: hex64('acce97ed'), prev_event_ids: [genesis.id], type: 'message', sender: SELF, content: {} }
	const opposing = { id: hex64('0bb05ed'), prev_event_ids: [genesis.id], type: 'role_assign', sender: ATTACKER, content: { targetPubKeyHash: VICTIM } }
	const blocked = computeOpposingForkBlockTargets([genesis, accepted, opposing], accepted.id, SELF).sort()
	assertEquals(blocked, [ATTACKER, VICTIM].sort())
})

Deno.test('computeOpposingForkBlockTargets returns empty when no fork', () => {
	const genesis = { id: hex64('9e5'), prev_event_ids: [], type: 'group_meta_update', sender: SELF }
	const only = { id: hex64('acce97ed'), prev_event_ids: [genesis.id], type: 'message', sender: SELF, content: {} }
	const blocked = computeOpposingForkBlockTargets([genesis, only], only.id, SELF)
	assertEquals(blocked, [])
})

Deno.test('computeOpposingForkBlockTargets rejects non-hex acceptedTipId', () => {
	const { events } = buildForkEvents()
	assertThrows(() => computeOpposingForkBlockTargets(events, 'not-a-tip', SELF), Error, 'acceptedTipId must be 64 hex chars')
})

Deno.test('computeOpposingForkBlockTargets rejects acceptedTipId that is not a current tip', () => {
	const { events } = buildForkEvents()
	assertThrows(() => computeOpposingForkBlockTargets(events, hex64('deadbeef'), SELF), Error, 'acceptedTipId is not a current DAG tip')
})
