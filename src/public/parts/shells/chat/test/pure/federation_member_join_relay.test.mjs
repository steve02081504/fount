/**
 * 冷启动 member_join 联邦出站：无物化 ACL 时仍须放行（与 shouldDefer 例外对齐），
 * 否则邀请入群后 live dag_event 发不出去，对端无法应答 join-snapshot。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { registerChatEventTypeDefs } from '../../src/chat/dag/eventTypes.mjs'
import {
	canRelayFederatedEvent,
	shouldDeferFederatedRelay,
	shouldDeferInboundIngest,
} from '../../src/chat/federation/acl.mjs'
import { selectBootstrapFlushEvents } from '../../src/chat/federation/bootstrapFlush.mjs'

registerChatEventTypeDefs()

const SENDER = 'a'.repeat(64)
const NODE = 'b'.repeat(64)

Deno.test('cold-start member_join is relayable without ACL snapshot', async () => {
	const emptyState = { members: {}, groupSettings: {} }
	const join = { type: 'member_join', sender: SENDER, content: {} }
	assertEquals(shouldDeferFederatedRelay(emptyState, join), false)
	assertEquals(shouldDeferInboundIngest(emptyState, join), false)
	assertEquals(await canRelayFederatedEvent(emptyState, join), true)
})

Deno.test('cold-start gated non-join events stay blocked by canRelay', async () => {
	const emptyState = { members: {}, groupSettings: {} }
	const kick = { type: 'member_kick', sender: SENDER, content: {} }
	assertEquals(shouldDeferFederatedRelay(emptyState, kick), true)
	assertEquals(await canRelayFederatedEvent(emptyState, kick), false)
})

Deno.test('batterySaver still blocks cold-start member_join relay', async () => {
	const state = { members: {}, groupSettings: { batterySaver: true } }
	const join = { type: 'member_join', sender: SENDER, content: {} }
	assertEquals(await canRelayFederatedEvent(state, join), false)
})

Deno.test('selectBootstrapFlushEvents includes local member_join even if not a tip', () => {
	const tip = {
		id: '1'.repeat(64),
		type: 'message',
		node_id: NODE,
		prev_event_ids: ['2'.repeat(64), '3'.repeat(64)],
	}
	const join = {
		id: '2'.repeat(64),
		type: 'member_join',
		node_id: NODE,
		prev_event_ids: [],
	}
	const otherJoin = {
		id: '3'.repeat(64),
		type: 'member_join',
		node_id: 'c'.repeat(64),
		prev_event_ids: [],
	}
	const selected = selectBootstrapFlushEvents([tip, join, otherJoin], NODE)
	assertEquals(selected.map(event => event.id).sort(), [join.id, tip.id].sort())
})
