/**
 * 无状态 PoW 入群策略校验。
 */
/* global Deno */
import { JOIN_POW_DEFAULT_EPOCH_MS, solveJoinPow } from 'fount/scripts/p2p/join_pow.mjs'
import { assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validateJoinPolicy } from '../../src/chat/governance/joinPolicy.mjs'

const ANCHOR = 'f'.repeat(64)
const JOINER = 'e'.repeat(64)

/**
 * 构造 PoW 入群策略测试状态。
 * @param {object} [overrides] 覆盖项
 * @returns {object} 物化群状态桩
 */
function powState(overrides = {}) {
	return {
		groupId: 'g-pow',
		groupSettings: {
			joinPolicy: 'pow',
			powFloorBits: 6,
			powEpochMs: JOIN_POW_DEFAULT_EPOCH_MS,
		},
		dagTips: [ANCHOR],
		roles: { '@everyone': {} },
		members: {},
		...overrides,
	}
}

Deno.test('pow join rejects missing solution', async () => {
	await assertRejects(
		() => validateJoinPolicy(powState(), {
			type: 'member_join', sender: JOINER, timestamp: 1, content: {},
		}, 'u'),
		Error,
		'invalid or expired pow solution',
	)
})

Deno.test('pow join accepts valid stateless solution', async () => {
	const epochMs = JOIN_POW_DEFAULT_EPOCH_MS
	const epoch = Math.floor(Date.now() / epochMs)
	const powSolution = solveJoinPow({
		groupId: 'g-pow',
		anchorRef: ANCHOR,
		joinerNodeHash: JOINER,
		epoch,
	}, 6)
	if (!powSolution) throw new Error('solveJoinPow failed')
	await validateJoinPolicy(powState(), {
		type: 'member_join', sender: JOINER, timestamp: 1,
		content: { powSolution },
	}, 'u')
})

Deno.test('active member replay skips pow', async () => {
	await validateJoinPolicy(powState({
		members: { [JOINER]: { status: 'active' } },
	}), {
		type: 'member_join', sender: JOINER, timestamp: 1, content: {},
	}, 'u')
})
