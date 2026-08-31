/**
 * 入群 PoW anchor 选择测试：稳定根优先 + resolvePowForJoin 使用外部 challenge。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { collectJoinPowAnchors } from '../../public/shared/joinPowAnchors.mjs'
import { resolvePowForJoin } from '../../public/src/powJoin.mjs'

Deno.test('collectJoinPowAnchors orders stable roots before tips', () => {
	const checkpoint = 'c'.repeat(64)
	const consensus = 'n'.repeat(64)
	const membersRoot = 'm'.repeat(64)
	const tipA = 'a'.repeat(64)
	const tipB = 'b'.repeat(64)
	const anchors = collectJoinPowAnchors({
		dagTips: [tipA, tipB],
		consensusBranchTip: consensus,
		membersRoot,
		checkpoint_event_id: checkpoint,
	})
	assertEquals(anchors[0], checkpoint, 'checkpoint root first')
	assertEquals(anchors[1], consensus, 'consensus branch tip second')
	assertEquals(anchors[2], membersRoot, 'membersRoot third')
	assertEquals(anchors.slice(3).sort(), [tipA, tipB].sort(), 'tips last')
})

Deno.test('collectJoinPowAnchors dedupes and tolerates missing fields', () => {
	const tip = 'a'.repeat(64)
	assertEquals(collectJoinPowAnchors({ dagTips: [tip, tip] }), [tip])
	assertEquals(collectJoinPowAnchors({}), [])
})

Deno.test('resolvePowForJoin solves against challenge anchors when state is empty', async () => {
	const solution = await resolvePowForJoin('g-pow', null, 'j'.repeat(64), {
		anchors: ['n'.repeat(64)],
		powFloorBits: 4,
	})
	assertEquals(solution?.anchorRef, 'n'.repeat(64))
	assertEquals(solution?.joinerNodeHash, 'j'.repeat(64))
})

Deno.test('resolvePowForJoin does not gate on joinPolicy (caller responsibility)', async () => {
	const solution = await resolvePowForJoin('g-open', null, 'j'.repeat(64), {
		anchors: ['n'.repeat(64)],
		powFloorBits: 4,
	})
	assert(solution, 'solves regardless of joinPolicy')
	assertEquals(solution.anchorRef, 'n'.repeat(64))
})

Deno.test('resolvePowForJoin returns null without anchors', async () => {
	assertEquals(await resolvePowForJoin('g-pow', null, 'j'.repeat(64)), null)
	assertEquals(await resolvePowForJoin('g-pow', {}, 'j'.repeat(64)), null)
})

Deno.test('resolvePowForJoin rejects powFloorBits above protocol maximum', async () => {
	assertEquals(await resolvePowForJoin('g-pow', null, 'j'.repeat(64), {
		anchors: ['n'.repeat(64)],
		powFloorBits: 257,
	}), null)
})

Deno.test('resolvePowForJoin prefers stable anchor from local state', async () => {
	const solution = await resolvePowForJoin('g-pow', {
		groupSettings: { joinPolicy: 'pow', powFloorBits: 4 },
		dagTips: ['a'.repeat(64)],
		checkpoint_event_id: 'n'.repeat(64),
	}, 'j'.repeat(64))
	assertEquals(solution?.anchorRef, 'n'.repeat(64), 'uses checkpoint root, not tip')
})
