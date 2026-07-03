import {
	Api,
	ApiMultipart,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	FedPngBytes,
	InitializeOpenGroupJoin,
	PollUntil,
	testCase,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

console.log('=== Setup: open group + join ===')
const setup = await InitializeOpenGroupJoin('FedEmoji', 'emoji-seed')
const gid = setup.groupId
let emojiId = null

console.log('\n=== 1. A uploads group emoji ===')
await testCase('A POST /groups/:id/emojis multipart', async () => {
	const r = await ApiMultipart(FedA, 'POST', `/groups/${gid}/emojis`, { name: 'fed-emoji' }, 'emoji', 'fed.png', FedPngBytes)
	if (r.status !== 201) throw new Error(`upload ${r.status}: ${r.raw}`)
	emojiId = r.json.entry?.emojiId
	return Boolean(emojiId)
})

await testCase('A GET emoji data locally', async () => {
	const r = await Api(FedA, 'GET', `/groups/${gid}/emojis/${emojiId}/data?json=1`)
	return r.status === 200 && String(r.json.dataUrl ?? '').startsWith('data:')
})

console.log('\n=== 2. B federation pull ===')
await testCase('B sees emoji in manifest', async () => PollUntil(60, 3, async () => {
	const r = await Api(FedB, 'GET', `/groups/${gid}/emojis`)
	return r.status === 200 && (r.json.entries?.filter(e => e.emojiId === emojiId).length ?? 0) >= 1
}))

await testCase('B GET emojis/:id/data (federation fetch)', async () => {
	const ok = await PollUntil(90, 4, async () => {
		const r = await Api(FedB, 'GET', `/groups/${gid}/emojis/${emojiId}/data?json=1`)
		return r.status === 200 && String(r.json.dataUrl ?? '').startsWith('data:image/')
	})
	return Boolean(ok)
})

await testCase('B data matches A (same length)', async () => {
	const a = await Api(FedA, 'GET', `/groups/${gid}/emojis/${emojiId}/data?json=1`)
	const b = await Api(FedB, 'GET', `/groups/${gid}/emojis/${emojiId}/data?json=1`)
	return a.json.dataUrl?.length > 20 && b.json.dataUrl?.length === a.json.dataUrl?.length
})

await ClearFedGroup(gid)
WriteFedSummary('FED-EMOJI', gid)
completeLiveScript()
