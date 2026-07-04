/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	createSocialTimelineState,
	finalizeSocialTimelineView,
	SOCIAL_TIMELINE_REDUCERS,
} from '../../../../public/parts/shells/social/src/timeline/reducers.mjs'
import {
	entriesForTargetEntityHash,
	isAuthorFilteredByPersonalSets,
	matchesPersonalListEntries,
	normalizePersonalListEntries,
} from '../../personal_block.mjs'
import { applyFollowedBlockSignal } from '../../reputation_social.mjs'

const NODE_A = 'a'.repeat(64)
const NODE_B = 'b'.repeat(64)
const SUBJ_C = 'c'.repeat(64)
const SUBJ_D = 'd'.repeat(64)
const USER_ENTITY = NODE_A + SUBJ_C
const AGENT_ENTITY = NODE_B + SUBJ_D

Deno.test('entriesForTargetEntityHash includes entity and subject', () => {
	const entries = entriesForTargetEntityHash(USER_ENTITY)
	assertEquals(entries.length, 2)
	assertEquals(entries.some(e => e.scope === 'entity' && e.value === USER_ENTITY), true)
	assertEquals(entries.some(e => e.scope === 'subject' && e.value === SUBJ_C), true)
})

Deno.test('matchesPersonalListEntries blocks by subject across nodes', () => {
	const entries = normalizePersonalListEntries([{ scope: 'subject', value: SUBJ_C }])
	const otherNodeEntity = 'f'.repeat(64) + SUBJ_C
	assertEquals(matchesPersonalListEntries(entries, { entityHash: otherNodeEntity }), true)
})

Deno.test('isAuthorFilteredByPersonalSets uses entity and subject sets', () => {
	const filterSets = {
		blockedEntityHashes: new Set([AGENT_ENTITY]),
		blockedSubjects: new Set(),
		hiddenEntityHashes: new Set(),
		hiddenSubjects: new Set(),
	}
	assertEquals(isAuthorFilteredByPersonalSets(filterSets, AGENT_ENTITY), true)
	assertEquals(isAuthorFilteredByPersonalSets(filterSets, USER_ENTITY), false)
})

Deno.test('social reducer block and unblock materialize blocked list', () => {
	let state = createSocialTimelineState()
	state = SOCIAL_TIMELINE_REDUCERS.block(state, {
		content: { targetEntityHash: USER_ENTITY },
	})
	state = SOCIAL_TIMELINE_REDUCERS.unblock(state, {
		content: { targetEntityHash: AGENT_ENTITY },
	})
	state = SOCIAL_TIMELINE_REDUCERS.block(state, {
		content: { targetEntityHash: AGENT_ENTITY },
	})
	const view = finalizeSocialTimelineView(state, ['e1'])
	assertEquals(view.blocked, [USER_ENTITY, AGENT_ENTITY])
})

Deno.test('applyFollowedBlockSignal selfTrust penalizes target node and unblocks symmetrically', async () => {
	/**
	 * 构造测试信誉数据。
	 * @type {import('../../reputation_store.mjs').ReputationFile}
	 */
	const data = { byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] }
	/**
	 * 运行信誉变更回调。
	 * @param {(d: import('../../reputation_store.mjs').ReputationFile) => void | Promise<void>} fn 变更回调
	 */
	const mutate = async fn => {
		await fn(data)
	}
	await applyFollowedBlockSignal({
		followerEntityHash: USER_ENTITY,
		targetEntityHash: AGENT_ENTITY,
		action: 'block',
		selfTrust: true,
	}, mutate)
	assertEquals(Number(data.byNodeHash[NODE_B]?.score ?? 0) < 0, true)
	const penalty = data.byNodeHash[NODE_B].socialBlocks?.[USER_ENTITY]?.penalty
	assertEquals(typeof penalty, 'number')
	await applyFollowedBlockSignal({
		followerEntityHash: USER_ENTITY,
		targetEntityHash: AGENT_ENTITY,
		action: 'unblock',
		selfTrust: true,
	}, mutate)
	assertEquals(data.byNodeHash[NODE_B]?.score ?? 0, 0)
	assertEquals(data.byNodeHash[NODE_B]?.socialBlocks?.[USER_ENTITY], undefined)
})

Deno.test('applyFollowedBlockSignal dedupes repeated block from same follower', async () => {
	/**
	 * 构造测试信誉数据。
	 * @type {import('../../reputation_store.mjs').ReputationFile}
	 */
	const data = {
		byNodeHash: { [NODE_A]: { score: 0.8 } },
		wantUnknownHits: [],
		relayBumpSeen: [],
	}
	/**
	 * 运行信誉变更回调。
	 * @param {(d: import('../../reputation_store.mjs').ReputationFile) => void | Promise<void>} fn 变更回调
	 */
	const mutate = async fn => {
		await fn(data)
	}
	await applyFollowedBlockSignal({
		followerEntityHash: USER_ENTITY,
		targetEntityHash: AGENT_ENTITY,
		action: 'block',
		selfTrust: false,
	}, mutate)
	const first = data.byNodeHash[NODE_B].score
	await applyFollowedBlockSignal({
		followerEntityHash: USER_ENTITY,
		targetEntityHash: AGENT_ENTITY,
		action: 'block',
		selfTrust: false,
	}, mutate)
	assertEquals(data.byNodeHash[NODE_B].score, first)
})
