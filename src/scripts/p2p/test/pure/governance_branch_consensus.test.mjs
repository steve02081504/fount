/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	clearEventTypeRegistry,
	registerEventTypeDefs,
} from '../../event_type_registry.mjs'
import {
	authzFoldOrderIds,
	selectAuthzBranchTip,
	selectConsensusBranchTip,
} from '../../governance_branch.mjs'

Deno.test('selectConsensusBranchTip picks branch with more governance events', () => {
	clearEventTypeRegistry()
	registerEventTypeDefs('test', { slash: { governance: true } })
	try {
		const root = '0'.repeat(64)
		const leftTip = '1'.repeat(64)
		const rightTip = '2'.repeat(64)
		const leftGov = '3'.repeat(64)
		const events = [
			{ id: leftTip, type: 'message', prev_event_ids: [leftGov] },
			{ id: leftGov, type: 'slash', prev_event_ids: [root] },
			{ id: rightTip, type: 'message', prev_event_ids: [root] },
			{ id: root, type: 'message', prev_event_ids: [] },
		]
		const byId = new Map(events.map(event => [event.id, event]))
		assertEquals(selectConsensusBranchTip([leftTip, rightTip], byId), leftTip)
	}
	finally {
		clearEventTypeRegistry()
	}
})

Deno.test('selectConsensusBranchTip tie-break prefers lexicographically larger tipId', () => {
	clearEventTypeRegistry()
	try {
		const root = '0'.repeat(64)
		const tipA = '1'.repeat(64)
		const tipB = '2'.repeat(64)
		const events = [
			{ id: tipA, type: 'message', prev_event_ids: [root] },
			{ id: tipB, type: 'message', prev_event_ids: [root] },
			{ id: root, type: 'message', prev_event_ids: [] },
		]
		const byId = new Map(events.map(event => [event.id, event]))
		assertEquals(selectConsensusBranchTip([tipA, tipB], byId), tipB)
	}
	finally {
		clearEventTypeRegistry()
	}
})

Deno.test('authzFoldOrderIds keeps only branch ancestor chain', () => {
	const root = '0'.repeat(64)
	const left = '1'.repeat(64)
	const right = '2'.repeat(64)
	const tip = '3'.repeat(64)
	const events = [
		{ id: tip, type: 'message', prev_event_ids: [left] },
		{ id: left, type: 'message', prev_event_ids: [root] },
		{ id: right, type: 'message', prev_event_ids: [root] },
		{ id: root, type: 'message', prev_event_ids: [] },
	]
	const byId = new Map(events.map(event => [event.id, event]))
	const order = [root, left, right, tip]
	assertEquals(authzFoldOrderIds(order, byId, tip), [root, left, tip])
})

Deno.test('selectAuthzBranchTip respects preferred tip', () => {
	clearEventTypeRegistry()
	try {
		const root = '0'.repeat(64)
		const tipA = '1'.repeat(64)
		const tipB = '2'.repeat(64)
		const events = [
			{ id: tipA, type: 'message', prev_event_ids: [root] },
			{ id: tipB, type: 'message', prev_event_ids: [root] },
			{ id: root, type: 'message', prev_event_ids: [] },
		]
		const byId = new Map(events.map(event => [event.id, event]))
		assertEquals(selectAuthzBranchTip([tipA, tipB], byId, {}, tipA), tipA)
	}
	finally {
		clearEventTypeRegistry()
	}
})
