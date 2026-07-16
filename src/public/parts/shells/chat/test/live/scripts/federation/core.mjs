import process from 'node:process'

import { ms } from 'fount/scripts/ms.mjs'
import {
	Api,
	ClearFedGroup,
	ClearFedTestGroups,
	FedA,
	FedB,
	InitializeOpenGroupJoin,
	WaitFedConverged,
	WaitFedLive,
} from 'fount/scripts/test/live/federation/common.mjs'

await ClearFedTestGroups()

console.log('=== 1. NodeA: create open group, seed A1, NodeB joins (members>=2 gate) ===')
const { groupId, channelId } = await InitializeOpenGroupJoin('FedTest', 'A1: hello from NodeA')
console.log(`groupId=${groupId}  channelId=${channelId}`)

console.log('\n=== 2. NodeB: read messages (expect A1 via catchup) ===')
const gotA1 = await WaitFedConverged(FedB, groupId, async () => {
	const listResponse = await Api(FedB, 'GET', `/groups/${groupId}/channels/${channelId}/messages?limit=50`)
	if (listResponse.status !== 200) return false
	const texts = listResponse.json.messages?.map(row => row.content?.content) ?? []
	console.log(`  NodeB sees ${texts.length} messages: ${texts.join(' | ')}`)
	return texts.some(t => String(t).includes('A1:'))
}, 120, 3, ms('6s'))
console.log(`NodeB received A1: ${gotA1 ? 'YES' : 'NO'}`)

console.log('\n=== 3. NodeB: send message #B1 ===')
const b1 = await Api(FedB, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
	content: { type: 'text', content: 'B1: reply from NodeB' },
})
if (b1.status !== 201) throw new Error(`B1 send failed: ${b1.status} ${b1.raw}`)

console.log('\n=== 4. NodeA: live push (GET-only, no catchup) ===')
const gotB1Live = await WaitFedLive(async () => {
	const listResponse = await Api(FedA, 'GET', `/groups/${groupId}/channels/${channelId}/messages?limit=50`)
	if (listResponse.status !== 200) return false
	const texts = listResponse.json.messages?.map(row => row.content?.content) ?? []
	console.log(`  NodeA live sees ${texts.length} messages: ${texts.join(' | ')}`)
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
