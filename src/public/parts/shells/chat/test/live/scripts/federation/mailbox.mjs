import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	InitializeOpenGroupJoin,
	P2pApi,
	PollUntil,
	testCase,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

console.log('=== 1. Mailbox summary (local observable) ===')
await testCase('A GET chat/mailbox/summary', async () => {
	const r = await Api(FedA, 'GET', '/mailbox/summary')
	return r.status === 200 && r.json.pendingCount != null
})

await testCase('B GET chat/mailbox/summary', async () => {
	const r = await Api(FedB, 'GET', '/mailbox/summary')
	return r.status === 200 && r.json.pendingCount != null
})

await testCase('A GET p2p/mailbox/summary', async () => {
	const r = await P2pApi(FedA, 'GET', '/mailbox/summary')
	return r.status === 200 && r.json.pendingCount != null
})

await testCase('B GET p2p/mailbox/summary', async () => {
	const r = await P2pApi(FedB, 'GET', '/mailbox/summary')
	return r.status === 200 && r.json.pendingCount != null
})

console.log('\n=== Setup: federated group ===')
const setup = await InitializeOpenGroupJoin('FedMailbox', 'mailbox-seed')
const gid = setup.groupId
const cid = setup.channelId

console.log('\n=== 2. Room ready → mailbox pull path ===')
await testCase('B POST federation/rebind (room bind)', async () => {
	const r = await Api(FedB, 'POST', `/groups/${gid}/federation/rebind`, {})
	return r.status === 200 && r.json.ok === true
})

await testCase('B POST federation/catchup (room activity)', async () => {
	const r = await Api(FedB, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: 3000 })
	return r.status === 200
})

await testCase('summary still healthy after room ops', async () => {
	const a = await Api(FedA, 'GET', '/mailbox/summary')
	const b = await Api(FedB, 'GET', '/mailbox/summary')
	return a.status === 200 && b.status === 200
})

console.log('\n=== 3. Live message while room up (not mailbox) ===')
let liveId = null

await testCase('A sends while B room warm', async () => {
	const r = await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: 'mailbox-live-check' },
	})
	if (r.status !== 201) throw new Error(`send ${r.status}`)
	liveId = r.json.event?.id
	return Boolean(liveId)
})

await testCase('B receives via federation (not mailbox)', async () => PollUntil(60, 3, async () => {
	const m = await Api(FedB, 'GET', `/groups/${gid}/channels/${cid}/messages`)
	return (m.json.messages?.filter(row => row.eventId === liveId).length ?? 0) >= 1
}))

await ClearFedGroup(gid)
WriteFedSummary('FED-MAILBOX', gid)
completeLiveScript()
