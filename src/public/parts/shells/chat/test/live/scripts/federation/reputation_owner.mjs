import { randomUUID } from 'node:crypto'

import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	InitializeOpenGroupJoin,
	InvokeFedCatchupSync,
	testCase,
	WaitFedConverged,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

console.log('=== Setup: open group + join ===')
const setup = await InitializeOpenGroupJoin('FedRepOwner', 'rep-owner-seed')
const groupId = setup.groupId

let resolvedTarget = null
const found = await WaitFedConverged(FedA, groupId, async () => {
	const state = await Api(FedA, 'GET', `/groups/${groupId}/state`)
	if (state.status !== 200) return false
	const candidate = state.json.meta?.members?.find(m => m.memberKey && !(m.roles ?? []).includes('founder'))
	if (candidate) {
		resolvedTarget = String(candidate.memberKey)
		return true
	}
	return false
}, 120, 3, 4000)
if (!found || !resolvedTarget)
	throw new Error('B member pubkey not resolved after join — federation setup incomplete')

const targetPubKeyHash = resolvedTarget
const ownerSuccessionTarget = targetPubKeyHash

/**
 * @param {object} state 物化群状态
 * @returns {boolean} 创始人是否已转让给目标成员
 */
function hasTransferredFounder(state) {
	if (state.groupMeta?.ownerPubKeyHash === ownerSuccessionTarget) return true
	if (state.delegatedOwnerPubKeyHash === ownerSuccessionTarget) return true
	const rows = state.members ?? []
	const target = rows.find(m => m.memberKey === ownerSuccessionTarget)
	if (!target) return false
	const targetIsFounder = (target.roles ?? []).includes('founder')
	const otherFounders = rows.filter(m =>
		m.memberKey !== ownerSuccessionTarget && (m.roles ?? []).includes('founder'),
	).length
	return targetIsFounder && otherFounders === 0
}

console.log('\n=== 1. Reputation slash fanout ===')
await testCase('A verified reputation/slash on B', async () => {
	const tips = await Api(FedA, 'GET', `/groups/${groupId}/dag/tips`)
	const tip = tips.json.tips?.[0]
	const response = await Api(FedA, 'POST', `/groups/${groupId}/reputation/slash`, {
		targetPubKeyHash,
		claim: 0.05,
		verified: true,
		proof: { eventId: tip },
	})
	if (response.status !== 200) throw new Error(`slash ${response.status}: ${response.raw}`)
	await InvokeFedCatchupSync(FedA, groupId, 12_000)
	const events = await Api(FedA, 'GET', `/groups/${groupId}/events?limit=20`)
	return (events.json.events?.filter(e => e.type === 'reputation_slash').length ?? 0) >= 1
})

await testCase('B GET reputation reflects slash (fanout/catchup)', async () => {
	const ok = await WaitFedConverged(FedB, groupId, async () => {
		const events = await Api(FedB, 'GET', `/groups/${groupId}/events?limit=40`)
		if (events.status !== 200) return false
		return (events.json.events?.filter(e =>
			e.type === 'reputation_slash' && e.content?.targetPubKeyHash === targetPubKeyHash,
		).length ?? 0) >= 1
	}, 300, 4, 12_000)
	if (!ok) throw new Error('B must receive reputation_slash via federation catchup (no manual A-side inject)')
	return true
})

console.log('\n=== 2. Owner-succession cross-node ===')
await testCase('A POST owner-succession → B', async () => {
	const state = await Api(FedA, 'GET', `/groups/${groupId}/state`)
	if (state.status !== 200) throw new Error(`state ${state.status}`)
	const activeOnA = (state.json.meta?.members?.filter(m => m.memberKey === ownerSuccessionTarget).length ?? 0) >= 1
	if (!activeOnA) throw new Error('proposed owner not active on A')
	const ballotId = `fed-rep-owner-os-${randomUUID().replace(/-/g, '').slice(0, 12)}`
	const response = await Api(FedA, 'POST', `/groups/${groupId}/owner-succession`, {
		proposedOwnerPubKeyHash: ownerSuccessionTarget,
		ballotId,
	})
	if (response.status !== 200) throw new Error(`succession ${response.status}: ${response.raw}`)
	await Api(FedA, 'POST', `/groups/${groupId}/dag/merge-tips`, {})
	return response.json.newOwnerPubKeyHash === ownerSuccessionTarget
})

await testCase('B state sees new owner (federation)', async () => {
	const ok = await WaitFedConverged(FedB, groupId, async () => {
		const stateResponse = await Api(FedB, 'GET', `/groups/${groupId}/state`)
		if (stateResponse.status !== 200) return false
		return hasTransferredFounder(stateResponse.json.meta)
	}, 120, 4, 8000)
	if (!ok) throw new Error('B must see owner succession via federation catchup (no manual A-side inject)')
	return Boolean(ok)
})

await ClearFedGroup(groupId)
WriteFedSummary('FED-REP-OWNER', groupId)
completeLiveScript()
