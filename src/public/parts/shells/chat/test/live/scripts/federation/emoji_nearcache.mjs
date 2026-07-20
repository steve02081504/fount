import {
	Api,
	ApiMultipart,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	FedPngBytes,
	InitializeOpenGroupJoin,
	pollUntil,
	testCase,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

console.log('=== Setup: open group + A/B join ===')
const setup = await InitializeOpenGroupJoin('FedEmojiNC', 'emoji-nc-seed')
const gid = setup.groupId
let emojiId = null
let contentHash = null
let firstHitDataUrlLen = 0

console.log('\n=== A uploads emoji (contentHash in manifest) ===')
await testCase('A POST /groups/:id/emojis', async () => {
	const r = await ApiMultipart(FedA, 'POST', `/groups/${gid}/emojis`, { name: 'nc-emoji' }, 'emoji', 'fed.png', FedPngBytes)
	if (r.status !== 201) throw new Error(`upload ${r.status}: ${r.raw}`)
	emojiId = r.json.entry?.emojiId
	contentHash = r.json.entry?.contentHash
	return Boolean(emojiId && contentHash)
})

console.log('\n=== B near-cache via /emoji-content ===')
await testCase('B manifest lists contentHash after federation sync', async () => pollUntil(async () => {
	const r = await Api(FedB, 'GET', `/groups/${gid}/emojis`)
	if (r.status !== 200) return false
	const e = r.json.entries?.find(row => row.emojiId === emojiId)
	return Boolean(e && e.contentHash === contentHash)
}, 90, 3))

await testCase('B GET /emoji-content resolves image (first hit)', async () => {
	const ok = await pollUntil(async () => {
		const r = await Api(FedB, 'GET', `/emoji-content/${gid}/${emojiId}?json=1`)
		if (r.status !== 200) return false
		firstHitDataUrlLen = r.json.dataUrl?.length ?? 0
		return r.json.contentHash === contentHash && firstHitDataUrlLen > 20
	}, 90, 4)
	return Boolean(ok)
})

await testCase('B GET /emoji-content again (cached local path)', async () => {
	const r = await Api(FedB, 'GET', `/emoji-content/${gid}/${emojiId}?json=1`)
	return r.status === 200 && r.json.dataUrl?.length === firstHitDataUrlLen
})

await ClearFedGroup(gid)
console.log('\n=== DONE fed_emoji_nearcache ===')
WriteFedSummary('FED-EMOJI-NC', gid)
completeLiveScript()
