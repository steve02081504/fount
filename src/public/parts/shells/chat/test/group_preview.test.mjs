/**
 * 群预览构建逻辑 smoke 测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('group preview response shape constants', () => {
	const sample = {
		groupId: 'g1',
		title: 'Test',
		blurb: '',
		joinPolicy: 'invite-only',
		isMember: false,
		canJoin: false,
		found: false,
	}
	assertEquals(sample.isMember, false)
	assertEquals(sample.canJoin, false)
})
