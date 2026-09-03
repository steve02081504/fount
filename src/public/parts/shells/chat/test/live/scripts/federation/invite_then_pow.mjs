/**
 * 联邦群"旧邀请链接加入已改 pow 的群" live 探针：
 * NodeA 先建 invite-only 群并签发邀请链接 → 再把 joinPolicy 改为 pow →
 * NodeB 拿着改策略之前生成的旧邀请链接（inviteCode + roomSecret）经 pow-challenge 解算后入群。
 * 覆盖非 discoveryPublic pow 群的 challenge 拉取（challenge 不带 roomSecret）与 join 复用旧房间凭证。
 */
import { solveJoinPow } from 'npm:@steve02081504/fount-p2p/governance/join_pow'

import { ms } from 'fount/scripts/ms.mjs'
import {
	Api,
	ClearFedGroup,
	ClearFedTestGroups,
	FedA,
	FedB,
	P2pApi,
	WarmupFedNodeLinks,
	pollUntil,
	requireCase,
	writeLiveSection,
} from 'fount/scripts/test/live/federation/common.mjs'

const POW_FLOOR_BITS = 6

await ClearFedTestGroups()

let groupId = ''
/** @type {{ inviteCode: string, roomSecret: string, signalingAppId: string, introducerPubKeyHash: string, introducerNodeHash: string }} */
let invite = null
let nodeBHash = ''
/** @type {{ anchors: string[], powFloorBits?: number, powEpochMs?: number } | null} */
let challenge = null

await requireCase('NodeA: create invite-only group and mint invite link', async () => {
	const group = (await Api(FedA, 'POST', '/groups/', {
		name: 'FedInviteThenPow',
		description: 'L4 fed probe',
	})).json
	groupId = String(group?.groupId || '')
	if (!groupId) throw new Error(`create group failed: ${group?.error || 'no groupId'}`)

	const ticket = (await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: ms('1h') })).json
	if (!ticket?.code) throw new Error(`invite-ticket failed: ${ticket?.error || 'no code'}`)
	invite = {
		inviteCode: ticket.code,
		roomSecret: ticket.roomSecret,
		signalingAppId: ticket.signalingAppId,
		introducerPubKeyHash: ticket.introducerPubKeyHash,
		introducerNodeHash: ticket.introducerNodeHash,
	}
	if (!invite.roomSecret) throw new Error('invite-ticket missing roomSecret')
	return true
})

await requireCase('NodeB: warmup links; challenge on invite-only group resolves fast to 404', async () => {
	const view = await P2pApi(FedB, 'GET', '/federation')
	if (view.status !== 200 || !view.json.nodeHash) throw new Error(`B federation view ${view.status}`)
	nodeBHash = String(view.json.nodeHash).trim()

	await WarmupFedNodeLinks([FedA, FedB])

	const probe = await pollUntil(async () => {
		const startedAt = Date.now()
		const response = await Api(FedB, 'GET', `/groups/${groupId}/pow-challenge?introducerNodeHash=${encodeURIComponent(invite.introducerNodeHash)}`)
		const elapsedMs = Date.now() - startedAt
		return response.status === 404 ? { elapsedMs } : null
	}, 40, 3)
	if (!probe) throw new Error('invite-only challenge never returned 404')
	// 非 pow 群须快速失败（后端已响应 pow:false），而不是空等 14s FETCH_TIMEOUT_MS 后超时。
	if (probe.elapsedMs > 10_000) throw new Error(`invite-only challenge took ${probe.elapsedMs}ms (slow timeout path)`)
	return true
})

await requireCase('NodeA: switch group joinPolicy to pow', async () => {
	const settings = await Api(FedA, 'PUT', `/groups/${groupId}/settings`, {
		joinPolicy: 'pow',
		powFloorBits: POW_FLOOR_BITS,
	})
	if (settings.status !== 200) throw new Error(`set settings ${settings.status}: ${settings.raw}`)
	return true
})

await requireCase('NodeB: fetch pow-challenge (no local replica, non-discoveryPublic)', async () => {
	challenge = await pollUntil(async () => {
		const response = await Api(FedB, 'GET', `/groups/${groupId}/pow-challenge?introducerNodeHash=${encodeURIComponent(invite.introducerNodeHash)}`)
		if (response.status !== 200) return null
		return response.json
	}, 30, 3)
	if (!challenge || !Array.isArray(challenge.anchors) || !challenge.anchors.length)
		throw new Error('pow-challenge missing anchors')
	if (challenge.roomSecret)
		throw new Error('pow-challenge unexpectedly returned roomSecret for non-discoveryPublic group')
	return true
})

await requireCase('NodeB: join with stale invite link + pow', async () => {
	if (!challenge) throw new Error('pow-challenge not resolved earlier')
	const floorBits = Number(challenge.powFloorBits) || POW_FLOOR_BITS
	const pow = solveJoinPow({
		groupId,
		anchorRef: challenge.anchors[0],
		joinerNodeHash: nodeBHash,
		epoch: Math.floor(Date.now() / (Number(challenge.powEpochMs) || 3_600_000)),
	}, floorBits, 5_000_000)
	if (!pow) throw new Error('solveJoinPow returned null')
	const join = await Api(FedB, 'POST', `/groups/${groupId}/join`, {
		inviteCode: invite.inviteCode,
		pow,
		roomSecret: invite.roomSecret,
		signalingAppId: invite.signalingAppId,
		introducerPubKeyHash: invite.introducerPubKeyHash,
		introducerNodeHash: invite.introducerNodeHash,
	})
	if (join.status !== 200) throw new Error(`join ${join.status}: ${join.raw}`)
	return true
})

await requireCase('NodeB: becomes active member (members>=2) with stale link', async () => {
	const ok = await pollUntil(async () => {
		await Api(FedB, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: ms('6s') }).catch(() => { })
		const state = await Api(FedB, 'GET', `/groups/${groupId}/state`)
		return state.status === 200
			&& state.json?.viewer?.isMember === true
			&& Number(state.json?.meta?.memberCount) >= 2
	}, 120, 4)
	if (!ok) throw new Error('NodeB never reached members>=2')
	return true
})

writeLiveSection('SUMMARY')
console.log(`groupId=${groupId}`)

await ClearFedGroup(groupId)
