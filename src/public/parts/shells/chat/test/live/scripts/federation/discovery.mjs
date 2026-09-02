/**
 * 联邦群发现 live 探针：NodeA 建 pow+discoveryPublic 群 → NodeB 发现页面出现该群 → NodeB 解 pow 入群。
 * 覆盖 discovery_query 的 node-scope 拉取链路与 pow-challenge 入群路径。
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

const DISCOVERY_TITLE = 'FedDiscovery Plaza'
const DISCOVERY_BLURB = 'a pow group advertised via node-scope discovery query'
const POW_FLOOR_BITS = 6

await ClearFedTestGroups()

let groupId = ''
let nodeBHash = ''

await requireCase('NodeA: create pow+discoveryPublic group', async () => {
	const group = (await Api(FedA, 'POST', '/groups/', {
		name: 'FedDiscovery',
		description: 'L4 fed probe',
	})).json
	groupId = String(group?.groupId || '')
	if (!groupId) throw new Error(`create group failed: ${group?.error || 'no groupId'}`)
	const settings = await Api(FedA, 'PUT', `/groups/${groupId}/settings`, {
		joinPolicy: 'pow',
		powFloorBits: POW_FLOOR_BITS,
		discoveryPublic: true,
		discoveryTitle: DISCOVERY_TITLE,
		discoveryBlurb: DISCOVERY_BLURB,
	})
	if (settings.status !== 200) throw new Error(`set settings ${settings.status}: ${settings.raw}`)
	const rebind = await Api(FedA, 'POST', `/groups/${groupId}/federation/rebind`, {})
	if (rebind.status !== 200) throw new Error(`rebind ${rebind.status}: ${rebind.raw}`)
	return true
})

await requireCase('NodeB: group appears on discovery page', async () => {
	const view = await P2pApi(FedB, 'GET', '/federation')
	if (view.status !== 200 || !view.json.nodeHash) throw new Error(`B federation view ${view.status}`)
	nodeBHash = String(view.json.nodeHash).trim()

	await WarmupFedNodeLinks([FedA, FedB])

	const seen = await pollUntil(async () => {
		await Api(FedB, 'POST', '/discovery/refresh', {}).catch(() => { })
		const response = await Api(FedB, 'GET', '/discovery?limit=80')
		if (response.status !== 200) return false
		const entries = response.json?.entries ?? []
		const hit = entries.find(entry => String(entry.groupId) === groupId)
		if (!hit) {
			console.log(`  NodeB discovery sees ${entries.length} entries (no target yet)`)
			return false
		}
		console.log(`  NodeB found entry: title=${hit.title} sources=${hit.sources?.length ?? 0}`)
		return true
	}, 120, 3)
	if (!seen) throw new Error('group never appeared on NodeB discovery page')
	return true
})

let challenge = null
await requireCase('NodeB: fetch pow-challenge (no local replica)', async () => {
	const introducer = (await P2pApi(FedA, 'GET', '/federation')).json?.nodeHash || ''
	const response = await Api(FedB, 'GET', `/groups/${groupId}/pow-challenge?introducerNodeHash=${encodeURIComponent(introducer)}`)
	if (response.status !== 200) throw new Error(`pow-challenge ${response.status}: ${response.raw}`)
	challenge = response.json
	if (!Array.isArray(challenge?.anchors) || !challenge.anchors.length) throw new Error('pow-challenge missing anchors')
	if (!challenge.roomSecret) throw new Error('pow-challenge missing roomSecret for discoveryPublic group')
	return true
})

await requireCase('NodeB: solve pow and join', async () => {
	const floorBits = Number(challenge.powFloorBits) || POW_FLOOR_BITS
	const pow = solveJoinPow({
		groupId,
		anchorRef: challenge.anchors[0],
		joinerNodeHash: nodeBHash,
		epoch: Math.floor(Date.now() / (Number(challenge.powEpochMs) || 3_600_000)),
	}, floorBits, 5_000_000)
	if (!pow) throw new Error('solveJoinPow returned null')
	const join = await Api(FedB, 'POST', `/groups/${groupId}/join`, {
		pow,
		roomSecret: challenge.roomSecret,
		signalingAppId: challenge.signalingAppId,
		introducerNodeHash: challenge.responderNodeHash || null,
	})
	if (join.status !== 200) throw new Error(`join ${join.status}: ${join.raw}`)
	return true
})

await requireCase('NodeB: becomes active member (members>=2)', async () => {
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
