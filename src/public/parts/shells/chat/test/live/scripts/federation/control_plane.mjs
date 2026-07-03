import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	InitializeOpenGroupJoin,
	testCase,
	WaitFedMembers,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

console.log('=== Setup: open group + join ===')
const setup = await InitializeOpenGroupJoin('FedControl', 'control-seed')
const groupId = setup.groupId
const channelId = setup.channelId

console.log('\n=== 1. Federation control plane ===')
await testCase('A POST federation/rebind (first call must ok)', async () => {
	const response = await Api(FedA, 'POST', `/groups/${groupId}/federation/rebind`, { channelId })
	return response.status === 200 && response.json.ok === true
})

await testCase('A POST federation/rebind (idempotent second call)', async () => {
	const response = await Api(FedA, 'POST', `/groups/${groupId}/federation/rebind`, { channelId })
	return response.status === 200 && response.json.ok === true && response.json.skipped === true
})

await testCase('A POST federation/rotate-room-secret', async () => {
	const response = await Api(FedA, 'POST', `/groups/${groupId}/federation/rotate-room-secret`, {})
	return response.status === 200 && Boolean(response.json.roomSecret)
})

await testCase('B POST federation/join-snapshot', async () => {
	const response = await Api(FedB, 'POST', `/groups/${groupId}/federation/join-snapshot`, {})
	return response.status === 200
})

await testCase('B POST federation/catchup after rotate', async () => {
	const response = await Api(FedB, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: 5000 })
	return response.status === 200
})

await testCase('members still>=2 after rotate', async () => WaitFedMembers(FedB, groupId))

console.log('\n=== 2. history-want ===')
let histMsg = null

await testCase('A posts history-want target', async () => {
	const response = await Api(FedA, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
		content: { type: 'text', content: 'history-want-target' },
	})
	if (response.status !== 201) throw new Error(`send ${response.status}`)
	histMsg = response.json.event?.id
	return Boolean(histMsg)
})

await testCase('B POST channels/:id/history-want', async () => {
	const response = await Api(FedB, 'POST', `/groups/${groupId}/channels/${channelId}/history-want`, { limit: 50 })
	return response.status === 200 && (response.json.messages?.length ?? 0) >= 1
})

console.log('\n=== 3. Discovery ===')
await testCase('A GET /discovery', async () => {
	const response = await Api(FedA, 'GET', '/discovery?limit=20')
	return response.status === 200
})

await testCase('A POST /discovery/refresh', async () => {
	const response = await Api(FedA, 'POST', '/discovery/refresh', {})
	return response.status === 200
})

await testCase('B GET /discovery sees index', async () => {
	const response = await Api(FedB, 'GET', '/discovery?limit=20')
	return response.status === 200
})

console.log('\n=== 4. POST events remote verify (B ingests A-signed row) ===')
await testCase('B applies signed event from A via POST /events/signed', async () => {
	const events = await Api(FedA, 'GET', `/groups/${groupId}/events?limit=5`)
	if (events.status !== 200) throw new Error(`events ${events.status}`)
	const row = events.json.events?.find(e => e.signature && e.id)
	if (!row) throw new Error('no signed event on A')
	const eventId = String(row.id)
	const response = await Api(FedB, 'POST', `/groups/${groupId}/events/signed`, { events: [row] })
	if (response.status !== 200) throw new Error(`ingest ${response.status}: ${response.raw}`)
	const onB = await Api(FedB, 'GET', `/groups/${groupId}/events?limit=20`)
	if (onB.status !== 200) throw new Error(`B events ${onB.status}`)
	return (onB.json.events?.filter(e => e.id === eventId).length ?? 0) === 1
})

await ClearFedGroup(groupId)
WriteFedSummary('FED-CONTROL', groupId)
completeLiveScript()
