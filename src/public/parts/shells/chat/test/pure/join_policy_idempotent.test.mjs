/**
 * member_join 创世角色限制的幂等性：
 * adopted-base catch-up 经 gossip 拉回已知 active 成员的创世 member_join（带 roles）必须放行，
 * 而新成员（未 active）擅自携带 roles 提权仍被拒。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

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

/**
 * 捕获 validateJoinPolicy 抛错，便于断言 message/pendable。
 * @param {object} state 群状态
 * @param {object} event member_join 事件
 * @param {{ source?: 'local' | 'federation' }} [options] 入站来源
 * @returns {Promise<Error | undefined>} 捕获到的错误；无错误返回 undefined
 */
async function captureJoinPolicyError(state, event, options) {
	try {
		await validateJoinPolicy(state, event, 'u', options)
		return undefined
	}
	catch (error) {
		return error
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

Deno.test('federation path: unknown-sender genesis join (with roles) is pendable, not hard-drop', async () => {
	// federation gossip 先于祖先链送达 A 的创世 member_join；B 此时已自我入群（activeBefore=1）但 A 尚未 active。
	// 该校验失败必须 pendable，让 remoteIngest 走 pending_ingest 队列等 catchup 补齐后重放。
	const state = baseState({ members: { [NEWCOMER]: { status: 'active', roles: ['@everyone'] } } })
	const thrown = await captureJoinPolicyError(state, {
		type: 'member_join', sender: FOUNDER, timestamp: 1,
		content: { roles: ['founder'] },
	}, { source: 'federation' })
	assertEquals(thrown?.message, 'member_join roles only allowed for genesis join')
	assertEquals(thrown?.pendable, true)
})

Deno.test('federation path: unknown-role member_join is pendable (role_create may arrive later)', async () => {
	const state = baseState({
		roles: { '@everyone': {} },
		members: { [NEWCOMER]: { status: 'active', roles: ['@everyone'] } },
	})
	const thrown = await captureJoinPolicyError(state, {
		type: 'member_join', sender: NEWCOMER, timestamp: 2,
		content: { roles: ['founder'] },
	}, { source: 'federation' })
	assertEquals(thrown?.message, 'member_join unknown role: founder')
	assertEquals(thrown?.pendable, true)
})

Deno.test('local path keeps role-related rejections non-pendable (prevents local self-elevation)', async () => {
	const state = baseState({ members: { [FOUNDER]: { status: 'active', roles: ['@everyone', 'founder'] } } })
	const thrown = await captureJoinPolicyError(state, {
		type: 'member_join', sender: NEWCOMER, timestamp: 2,
		content: { roles: ['founder'] },
	}) // source 缺省 = local
	assertEquals(thrown?.message, 'member_join roles only allowed for genesis join')
	assertEquals(thrown?.pendable, undefined)
})
