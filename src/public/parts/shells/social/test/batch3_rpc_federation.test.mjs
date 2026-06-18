/**
 * Batch 3：social_rpc / 联邦导出过滤 / 探索 / feed 可见性。
 * handleSocialRpc 分发；filterEventsForFederatedPull 出站可见性边界；
 * buildFederatedTimelinePullResponse 游标；discoverAccounts/Posts；buildHomeFeed/ProfileFeed。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap, randomSeed, seedRemoteTimeline } from './harness.mjs'

const { username, operator } = await bootstrap()

const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('../../../../../scripts/p2p/entity_id.mjs')

const append = await import('../src/timeline/append.mjs')
const sync = await import('../src/timeline/sync.mjs')
const fedExport = await import('../src/timeline/federationExport.mjs')
const discovery = await import('../src/discovery.mjs')
const feed = await import('../src/feed.mjs')
const following = await import('../src/following.mjs')
const socialMeta = await import('../src/socialMeta.mjs')

const TARGET = 'a'.repeat(128)

/**
 * 发布一条 operator 帖子（不 fanout）。
 * @param {string} text 帖子正文
 * @param {string} [visibility='public'] 可见性
 * @returns {Promise<object>} 已提交事件
 */
async function postAs(text, visibility = 'public') {
	return append.commitTimelineEvent(username, operator, {
		type: 'post', content: { text, visibility, lang: 'zh-CN' },
	}, { fanout: false })
}

Deno.test('handleSocialRpc: unknown rpc type returns null', async () => {
	assertEquals(await discovery.handleSocialRpc(username, { type: 'not_a_real_rpc' }), null)
})

Deno.test('handleSocialRpc: timeline_pull returns events for owner', async () => {
	await postAs('rpc pull post 1')
	const resp = await discovery.handleSocialRpc(username, {
		type: 'social_timeline_pull_request', entityHash: operator, afterEventId: null,
	}, { requesterNodeHash: null })
	assertEquals(resp.type, 'social_timeline_pull_response')
	assertEquals(resp.entityHash, operator.toLowerCase())
	assert(resp.events.length >= 1)
})

Deno.test('federation export: private event types never leak', async () => {
	await append.commitTimelineEvent(username, operator, {
		type: 'follow', content: { targetEntityHash: TARGET, rep_edge: 1 },
	}, { fanout: false })
	await append.commitTimelineEvent(username, operator, {
		type: 'like', content: { targetEntityHash: TARGET, targetPostId: 'c'.repeat(64) },
	}, { fanout: false })

	const all = await append.readTimelineEvents(username, operator)
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	const exportedTypes = new Set(exported.map(e => e.type))
	for (const priv of ['follow', 'unfollow', 'like', 'unlike', 'follow_approve', 'file_share'])
		assert(!exportedTypes.has(priv), `private type ${priv} must not be exported`)
})

Deno.test('federation export: followers-only post hidden from anonymous requester', async () => {
	const pub = await postAs('public visible', 'public')
	const foll = await postAs('followers only secret', 'followers')
	const all = await append.readTimelineEvents(username, operator)
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	const ids = new Set(exported.map(e => e.id))
	assert(ids.has(pub.id), 'public post should be exported')
	assert(!ids.has(foll.id), 'followers-only post should be hidden from anonymous')
})

Deno.test('federation export: social_meta hidden when timeline protected', async () => {
	await socialMeta.updateSocialMeta(username, operator, { isProtected: true })
	const all = await append.readTimelineEvents(username, operator)
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	assert(!exported.some(e => e.type === 'social_meta'), 'social_meta hidden for protected timeline to anon')
	await socialMeta.updateSocialMeta(username, operator, { isProtected: false })
})

Deno.test('buildFederatedTimelinePullResponse honors afterEventId cursor', async () => {
	const all = await append.readTimelineEvents(username, operator)
	const firstId = all[0].id
	const fromStart = await sync.buildFederatedTimelinePullResponse(username, operator, null, null)
	const afterFirst = await sync.buildFederatedTimelinePullResponse(username, operator, firstId, null)
	assert(afterFirst.length < fromStart.length, 'cursor should reduce returned set')
})

Deno.test('discoverFollowGraph: protected foreign timeline hides following from non-owner', async () => {
	// 构造一个远端 user 型 owner（sender==subjectHash），其时间线 protected 且 follow 了 TARGET
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('1'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { isProtected: true, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: TARGET, rep_edge: 1 } },
	])

	// 非 owner、非本节点请求者 → following 隐藏
	const hidden = await discovery.discoverFollowGraph(username, foreignOwner, { requesterNodeHash: 'b'.repeat(64) })
	assertEquals(hidden.length, 0, 'non-owner sees empty following for protected timeline')
})

Deno.test('discoverFollowGraph: public foreign timeline exposes following', async () => {
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('2'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { isProtected: false, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: TARGET, rep_edge: 1 } },
	])

	const visible = await discovery.discoverFollowGraph(username, foreignOwner, { requesterNodeHash: 'b'.repeat(64) })
	assert(visible.includes(TARGET.toLowerCase()), 'public timeline following visible to anyone')
})

Deno.test('discoverAccounts skips protected timelines', async () => {
	const before = await discovery.discoverAccounts(username, { n: 50 })
	assert(before.accounts.some(a => a.entityHash === operator.toLowerCase()), 'operator listed when public')
	await socialMeta.updateSocialMeta(username, operator, { isProtected: true })
	const after = await discovery.discoverAccounts(username, { n: 50 })
	assert(!after.accounts.some(a => a.entityHash === operator.toLowerCase()), 'protected operator hidden')
	await socialMeta.updateSocialMeta(username, operator, { isProtected: false })
})

Deno.test('buildProfileFeedItems returns own posts', async () => {
	const { items } = await feed.buildProfileFeedItems(username, operator)
	assert(items.length >= 1)
	assert(items.every(item => item.entityHash === operator.toLowerCase()))
})

Deno.test('buildHomeFeed includes own public posts', async () => {
	const { items } = await feed.buildHomeFeed(username, { limit: 50 })
	assert(items.length >= 1, 'home feed should include operator self posts')
})

// 回归：远端作者的资料/帖子不得让 feed/discover 抛错（修复 ensureLocalEntityProfile 误用）。
Deno.test('remote author profile + posts do not break feed/discover', async () => {
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('3'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { isProtected: false, createdAt: 1 } },
		{ type: 'post', content: { text: 'remote authored post', visibility: 'public' } },
	])

	// 直接取远端资料：不应抛错
	const profile = await feed.getEntityProfile(username, remoteOwner)
	assert(profile, 'remote profile should resolve to derived defaults')

	// 关注远端账户后构建首页 feed：作者资料加载不得抛错，远端帖可见
	await following.setFollow(username, remoteOwner, true)
	const { items } = await feed.buildHomeFeed(username, { limit: 50 })
	assert(items.some(item => item.entityHash === remoteOwner.toLowerCase()), 'remote post visible in home feed')

	// 探索接口遍历含远端 owner，不得抛错
	const discovered = await discovery.discoverAccounts(username, { n: 50 })
	assert(discovered.accounts.some(a => a.entityHash === remoteOwner.toLowerCase()), 'remote public account discoverable')
	await following.setFollow(username, remoteOwner, false)
})
