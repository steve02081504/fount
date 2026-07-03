import {
	Api,
	ApiMultipart,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	FedPngBytes,
	InvokeFedCatchupSync,
	P2pApi,
	PollUntil,
	testCase,
	WaitFedConverged,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'

let gid = null
let cid = null
let emojiId = null
let emojiContentHash = null

console.log('\n=== P2P warmup (user-room for fed_chunk_get fanout) ===')
let aNodeHash = null
await testCase('federation identity ready on A/B', async () => {
	const fa = await P2pApi(FedA, 'GET', '/federation')
	const fb = await P2pApi(FedB, 'GET', '/federation')
	aNodeHash = fa.json.nodeHash
	return fa.status === 200 && fb.status === 200 && fa.json.activePubKeyHex && fb.json.activePubKeyHex
})

if (aNodeHash) {
	await P2pApi(FedB, 'POST', '/federation/connect-node', { targetNodeHash: aNodeHash })
	const connected = await PollUntil(30, 2, async () => {
		const fb = await P2pApi(FedB, 'GET', '/federation')
		return fb.status === 200
	})
	if (!connected) throw new Error('B failed to connect to A user-room for non-member emoji path')
}

console.log('\n=== Setup: A creates group + emoji (B does not join) ===')
await testCase('A creates group (B stays non-member)', async () => {
	const g = (await Api(FedA, 'POST', '/groups/', { name: 'FedEmojiNM', description: 'L4 fed probe' })).json
	gid = g.groupId
	cid = g.defaultChannelId
	await Api(FedA, 'PUT', `/groups/${gid}/settings`, { joinPolicy: 'invite-only', discoveryPublic: true })
	return Boolean(gid)
})

await testCase('A uploads group emoji', async () => {
	const r = await ApiMultipart(FedA, 'POST', `/groups/${gid}/emojis`, { name: 'nm-emoji' }, 'emoji', 'fed.png', FedPngBytes)
	if (r.status !== 201) throw new Error(`upload ${r.status}: ${r.raw}`)
	emojiId = r.json.entry?.emojiId
	emojiContentHash = r.json.entry?.contentHash
	return Boolean(emojiId)
})

await testCase('A seeds channel (federation metadata)', async () => {
	const r = await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: `seed :[${gid}/${emojiId}]:` },
	})
	return r.status === 200 || r.status === 201
})

console.log('\n=== B (non-member) emoji-content ===')
await InvokeFedCatchupSync(FedA, gid, 8000)

await testCase('B GET /emoji-content without membership', async () => {
	if (!emojiContentHash) throw new Error('upload must yield contentHash for non-member CAS path')
	const hashQ = `?json=1&contentHash=${emojiContentHash}`
	const ok = await WaitFedConverged(FedB, gid, async () => {
		await Api(FedB, 'GET', `/groups/${gid}/preview`)
		const r = await Api(FedB, 'GET', `/emoji-content/${gid}/${emojiId}${hashQ}`)
		return r.status === 200 && Boolean(r.json.dataUrl)
	}, 120, 5, 4000)
	if (!ok) throw new Error('non-member B must resolve /emoji-content on B node (not A-side fallback)')
	return true
})

await testCase('B GET groups/:id/preview (non-member)', async () => {
	const ok = await PollUntil(30, 3, async () => {
		const r = await Api(FedB, 'GET', `/groups/${gid}/preview`)
		return r.status === 200 && r.json.isMember === false
	})
	return Boolean(ok)
})

await ClearFedGroup(gid)
WriteFedSummary('FED-EMOJI-NM', gid)
completeLiveScript()
