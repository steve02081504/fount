import process from 'node:process'

import {
	Api,
	AssertFedPeersReady,
	ClearFedGroup,
	ClearFedTestGroups,
	FedA,
	FedB,
	WaitFedConverged,
	WaitFedLive,
	WaitFedMembers,
} from 'fount/scripts/test/live/federation/common.mjs'

await ClearFedTestGroups()

console.log('=== 1. NodeA: create group ===')
const g = await Api(FedA, 'POST', '/groups/', { name: 'FedTest', description: 'two-node federation test' })
if (g.status !== 201) throw new Error(`create group failed: ${g.status}`)
const groupId = g.json.groupId
const channelId = g.json.defaultChannelId
console.log(`groupId=${groupId}  channelId=${channelId}`)

console.log('\n=== 2. NodeA: set joinPolicy=open ===')
await Api(FedA, 'PUT', `/groups/${groupId}/settings`, { joinPolicy: 'open' })

console.log('\n=== 3. NodeA: create invite-ticket (get room creds) ===')
const inv = await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: 3_600_000 })
if (inv.status !== 200 && inv.status !== 201) throw new Error(`invite-ticket failed: ${inv.status}`)
const { signalingAppId, roomSecret, introducerPubKeyHash: introducer } = inv.json
console.log(`signalingAppId=${signalingAppId}`)
console.log(`roomSecret=${roomSecret.substring(0, Math.min(16, roomSecret.length))}...`)
console.log(`introducer=${introducer}`)

console.log('\n=== 4. NodeA: send message #A1 ===')
await Api(FedA, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
	content: { type: 'text', content: 'A1: hello from NodeA' },
})

console.log('\n=== 5. NodeB: join group (no inviteCode, with room creds) ===')
const jr = await Api(FedB, 'POST', `/groups/${groupId}/join`, {
	roomSecret,
	signalingAppId,
	introducerPubKeyHash: introducer,
})
if (jr.status !== 200) throw new Error(`join failed: ${jr.status} ${jr.raw}`)
console.log(`join result: ${JSON.stringify(jr.json)}`)

console.log('\n=== 6. NodeB: federation health gate (members>=2) ===')
await AssertFedPeersReady(groupId)
const bReady = await WaitFedMembers(FedB, groupId, 2, 120)
if (!bReady) throw new Error('NodeB never materialized group state (members>=2)')

console.log('\n=== 7. NodeB: read messages (expect A1 via catchup) ===')
const gotA1 = await WaitFedConverged(FedB, groupId, async () => {
	const msgs = await Api(FedB, 'GET', `/groups/${groupId}/channels/${channelId}/messages?limit=50`)
	if (msgs.status !== 200) return false
	const texts = msgs.json.messages?.map(row => row.content?.content) ?? []
	console.log(`  NodeB sees ${texts.length} msgs: ${texts.join(' | ')}`)
	return texts.some(t => String(t).includes('A1:'))
}, 120, 3, 6000)
console.log(`NodeB received A1: ${gotA1 ? 'YES' : 'NO'}`)

console.log('\n=== 8. NodeB: send message #B1 ===')
const b1 = await Api(FedB, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
	content: { type: 'text', content: 'B1: reply from NodeB' },
})
if (b1.status !== 201) throw new Error(`B1 send failed: ${b1.status} ${b1.raw}`)

console.log('\n=== 9. NodeA: live push (GET-only, no catchup) ===')
const gotB1Live = await WaitFedLive(async () => {
	const msgs = await Api(FedA, 'GET', `/groups/${groupId}/channels/${channelId}/messages?limit=50`)
	if (msgs.status !== 200) return false
	const texts = msgs.json.messages?.map(row => row.content?.content) ?? []
	console.log(`  NodeA live sees ${texts.length} msgs: ${texts.join(' | ')}`)
	return texts.some(t => String(t).includes('B1:'))
}, 90, 3)
console.log(`NodeA received B1 via live push: ${gotB1Live ? 'YES' : 'NO'}`)

console.log('\n=== SUMMARY ===')
console.log(`groupId=${groupId}`)
console.log(`catchup(A1->B): ${gotA1 ? 'PASS' : 'FAIL'}`)
console.log(`live(B1->A):    ${gotB1Live ? 'PASS' : 'FAIL'}`)

let fail = 0
if (!gotA1) fail++
if (!gotB1Live) fail++
await ClearFedGroup(groupId)
if (fail > 0) process.exit(1)
