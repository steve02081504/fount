/**
 * member_join 创世角色限制的幂等性：
 * adopted-base catch-up 经 gossip 拉回已知 active 成员的创世 member_join（带 roles）必须放行，
 * 而新成员（未 active）擅自携带 roles 提权仍被拒。
 */
/* global Deno */
import { assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validateJoinPolicy } from '../../src/chat/governance/joinPolicy.mjs'

const FOUNDER = 'a'.repeat(64)
const NEWCOMER = 'b'.repeat(64)

/**
 * 构造最小群状态桩。
 * @param {object} [overrides] state 覆盖项
 * @returns {object} 物化群状态桩
 */
function baseState(overrides = {}) {
	return {
		groupId: 'g',
		groupSettings: { joinPolicy: 'open' },
		roles: { '@everyone': {}, founder: { permissions: { ADMIN: true } } },
		members: {},
		...overrides,
	}
}

Deno.test('genesis member_join with roles is allowed (no active members yet)', async () => {
	const state = baseState()
	await validateJoinPolicy(state, {
		type: 'member_join', sender: FOUNDER, timestamp: 1,
		content: { roles: ['founder'] },
	}, 'u')
})

Deno.test('new member carrying roles while group already has active members is rejected', async () => {
	const state = baseState({ members: { [FOUNDER]: { status: 'active', roles: ['@everyone', 'founder'] } } })
	await assertRejects(
		() => validateJoinPolicy(state, {
			type: 'member_join', sender: NEWCOMER, timestamp: 2,
			content: { roles: ['founder'] },
		}, 'u'),
		Error,
		'member_join roles only allowed for genesis join',
	)
})

Deno.test('replayed genesis member_join from an already-active member is idempotently allowed', async () => {
	// adopted-base：B 采纳 A 的 checkpoint 后 members 已含 active 的 A，catch-up 拉回 A 的创世 join（带 roles）。
	const state = baseState({ members: { [FOUNDER]: { status: 'active', roles: ['@everyone', 'founder'] } } })
	await validateJoinPolicy(state, {
		type: 'member_join', sender: FOUNDER, timestamp: 1,
		content: { roles: ['founder'] },
	}, 'u')
})
