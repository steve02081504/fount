import { formatEmojiToken } from 'fount/public/parts/shells/chat/public/shared/inlineTokenSyntax.mjs'
import { ms } from 'fount/scripts/ms.mjs'
import {
	Api,
	ApiMultipart,
	ClearFedGroup,
	completeLiveScript,
	FedA,
	FedB,
	FedPngBytes,
	P2pApi,
	pollUntil,
	RootApi,
	ShellApi,
	testCase,
	WarmupFedNodeLinks,
	WriteFedSummary,
} from 'fount/scripts/test/live/federation/common.mjs'
import { sleep } from 'fount/scripts/test/live/http.mjs'

const groupTitle = 'FedCrossShell'
let gid = null
let cid = null
let emojiId = null
let emojiContentHash = null
let postId = null
let emojiToken = null
/** @type {unknown[]} */
let postMediaRefs = []
let postText = null

console.log('=== cross_shell_emoji: registry smoke ===')
await testCase('Chat emoji registry reachable', async () => {
	const r = await RootApi(FedA, 'GET', '/api/registries/emoji')
	return r.status === 200 && (r.json?.filter(row => String(row.path).includes('providers/emoji')).length ?? 0) >= 1
})

await testCase('markdown_extensions registry reachable', async () => {
	const r = await RootApi(FedA, 'GET', '/api/registries/markdown_extensions')
	return r.status === 200 && (r.json?.length ?? 0) >= 1
})

console.log('\n=== Setup: B follows A (TrustGraph CAS fanout for non-member emoji) ===')
await testCase('B follows A operator entity', async () => {
	const viewerA = (await ShellApi(FedA, 'chat', 'GET', '/viewer')).json.viewerEntityHash
	if (!viewerA) throw new Error('no viewerEntityHash on A')
	const r = await ShellApi(FedB, 'social', 'POST', '/relationships/follow', { entityHash: viewerA, follow: true })
	return r.status === 200
})

console.log('\n=== P2P warmup ===')
await testCase('federation identity ready on A/B', async () => {
	const fa = await P2pApi(FedA, 'GET', '/federation')
	const fb = await P2pApi(FedB, 'GET', '/federation')
	return fa.status === 200 && fb.status === 200 && fa.json.activePubKeyHex && fb.json.activePubKeyHex
})
await WarmupFedNodeLinks([FedA, FedB])
await sleep(ms('5s'))

console.log('\n=== Setup: A private group + emoji (B stays non-member) ===')
await testCase('A creates invite-only group', async () => {
	const g = (await Api(FedA, 'POST', '/groups/', { name: groupTitle, description: 'L4 fed probe' })).json
	gid = g.groupId
	cid = g.defaultChannelId
	await Api(FedA, 'PUT', `/groups/${gid}/settings`, { joinPolicy: 'invite-only', discoveryPublic: true })
	return Boolean(gid)
})

await testCase('A uploads group emoji', async () => {
	const r = await ApiMultipart(FedA, 'POST', `/groups/${gid}/emojis`, { name: 'cross-emoji' }, 'emoji', 'fed.png', FedPngBytes)
	if (r.status !== 201) throw new Error(`upload ${r.status}: ${r.raw}`)
	emojiId = r.json.entry?.emojiId
	emojiContentHash = r.json.entry?.contentHash
	return Boolean(emojiId)
})

await testCase('A seeds channel (federation metadata)', async () => {
	await sleep(ms('2s'))
	await Api(FedA, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('6s') })
	emojiToken = formatEmojiToken(gid, emojiId)
	const r = await Api(FedA, 'POST', `/groups/${gid}/channels/${cid}/messages`, {
		content: { type: 'text', content: `seed ${emojiToken}` },
	})
	return r.status === 200 || r.status === 201
})

console.log('\n=== A posts Social feed with group emoji token ===')
await testCase('A feed post embeds groupEmoji mediaRef and retains token', async () => {
	const viewer = (await ShellApi(FedA, 'chat', 'GET', '/viewer')).json.viewerEntityHash
	if (!viewer) throw new Error('no viewerEntityHash')
	const text = `cross-shell feed ${emojiToken}`
	const r = await ShellApi(FedA, 'social', 'POST', '/posts', {
		entityHash: viewer,
		text,
		visibility: 'public',
		locale: 'zh-CN',
	})
	if (r.status !== 200) throw new Error(`post ${r.status}: ${r.raw}`)
	postId = r.json.event?.id
	postMediaRefs = r.json.event?.content?.mediaRefs?.filter(ref => ref.kind === 'groupEmoji') ?? []
	postText = r.json.event?.content?.text
	return Boolean(postId)
		&& postMediaRefs.length >= 1
		&& Boolean(postMediaRefs[0]?.contentHash)
		&& String(postText ?? '').includes(emojiToken)
})

console.log('\n=== B (non-member) emoji-content + private preview ===')
await Api(FedA, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('8s') })

await testCase('B GET /emoji-content without group membership', async () => {
	let hash = postMediaRefs[0]?.contentHash
	if (!hash) hash = emojiContentHash
	if (!hash) throw new Error('post or upload must yield contentHash for non-member CAS path')
	const hashQ = `?json=1&contentHash=${hash}`
	const ok = await pollUntil(async () => {
		await Api(FedB, 'GET', `/groups/${gid}/preview`)
		await Api(FedB, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('3s') })
		const r = await Api(FedB, 'GET', `/emoji-content/${gid}/${emojiId}${hashQ}`)
		return r.status === 200 && Boolean(r.json.dataUrl)
	}, 120, 5)
	if (!ok) {
		const hash = postMediaRefs[0]?.contentHash ?? emojiContentHash
		const last = await Api(FedB, 'GET', `/emoji-content/${gid}/${emojiId}?json=1&contentHash=${hash}`)
		throw new Error(`non-member B must resolve /emoji-content (not A-side fallback); last status=${last.status} raw=${last.raw}`)
	}
	return true
})

await testCase('B GET /groups/:id/preview as non-member', async () => {
	const ok = await pollUntil(async () => {
		await Api(FedA, 'POST', `/groups/${gid}/federation/catchup`, { waitMs: ms('3s') })
		const r = await Api(FedB, 'GET', `/groups/${gid}/preview`)
		return r.status === 200 && r.json.isMember === false
	}, 120, 4)
	return Boolean(ok)
})

await testCase('B preview hides join for invite-only private group', async () => {
	const ok = await pollUntil(async () => {
		const r = await Api(FedB, 'GET', `/groups/${gid}/preview`)
		return r.status === 200 && r.json.canJoin === false
	}, 30, 3)
	return Boolean(ok)
})

await ClearFedGroup(gid)
WriteFedSummary('CROSS-SHELL-EMOJI', gid)
completeLiveScript()
