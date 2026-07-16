import {
	Api,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	InitializeOpenGroupJoin,
	PollUntil,
	testCase,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

console.log('=== Setup: open group + join ===')
const setup = await InitializeOpenGroupJoin('FedArchive', 'archive-seed-0')
const gid = setup.groupId
const cid = setup.channelId
const targetMonth = new Date().toISOString().slice(0, 7)
console.log(`targetMonth=${targetMonth}`)

console.log('\n=== 1. A: shrink hot window + seed messages ===')
await testCase('A set hotLatestMessageCount=1', async () => {
	const r = await Api(FedA, 'PUT', `/groups/${gid}/settings`, { hotLatestMessageCount: 1 })
	return r.status === 200
})

await testCase('A posts archive candidates', async () => {
	for (let i = 1; i <= 4; i++) {
		const postResponse = await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
			content: { type: 'text', content: `archive-message-${i}` },
		})
		if (postResponse.status !== 201) throw new Error(`message ${i} status ${postResponse.status}`)
	}
	return true
})

console.log('\n=== 2. A: compact → cold archive files ===')
await testCase('A POST compact triggers archive fold', async () => {
	const r = await Api(FedA, 'POST', `/groups/${gid}/compact`, {})
	if (r.status !== 200) throw new Error(`compact ${r.status}`)
	return true
})

await testCase('A archive/summary has month file', async () => {
	const found = await PollUntil(45, 3, async () => {
		const s = await Api(FedA, 'GET', `/groups/${gid}/archive/summary`)
		if (s.status !== 200) return false
		return (s.json.files?.filter(f => f.month === targetMonth && f.bytes > 0).length ?? 0) >= 1
	})
	return Boolean(found)
})

console.log('\n=== 3. B: offline-mark + archive/sync ===')
await testCase('B POST federation/offline-mark', async () => {
	const r = await Api(FedB, 'POST', `/groups/${gid}/federation/offline-mark`, { wallMs: Date.now() })
	return r.status === 200 || r.status === 204
})

await testCase('B POST archive/sync', async () => {
	const r = await Api(FedB, 'POST', `/groups/${gid}/archive/sync`, {})
	if (r.status !== 200) throw new Error(`sync ${r.status}: ${r.raw}`)
	return true
})

await testCase('B archive/summary has target month', async () => {
	const found = await PollUntil(90, 4, async () => {
		const s = await Api(FedB, 'GET', `/groups/${gid}/archive/summary`)
		if (s.status !== 200) return false
		return (s.json.files?.filter(f => f.month === targetMonth && f.bytes > 0).length ?? 0) >= 1
	})
	return Boolean(found)
})

await testCase('B can read archived message via GET messages', async () => {
	const found = await PollUntil(60, 3, async () => {
		const listResponse = await Api(FedB, 'GET', `/groups/${gid}/channels/${cid}/messages?limit=50`)
		if (listResponse.status !== 200) return false
		return (listResponse.json.messages?.filter(row => /archive-message-/.test(String(row.content?.content))).length ?? 0) >= 1
	})
	return Boolean(found)
})

await ClearFedGroup(gid)
WriteFedSummary('FED-ARCHIVE-MONTH', gid)
completeLiveScript()
