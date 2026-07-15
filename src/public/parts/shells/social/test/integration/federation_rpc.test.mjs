/**
 * social_rpc / 联邦导出过滤 / 探索 / feed 可见性。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')

const append = await import('../../src/timeline/append.mjs')
const sync = await import('../../src/timeline/sync.mjs')
const fedExport = await import('../../src/timeline/federationExport.mjs')
const discoverRpc = await import('../../src/discover/rpc.mjs')
const discoverLocal = await import('../../src/discover/local.mjs')
const feed = await import('../../src/feed.mjs')
const following = await import('../../src/following.mjs')
const socialMeta = await import('../../src/socialMeta.mjs')

const TARGET = placeholderEntityHash('a')

/**
 * 发布一条 operator 帖子（不 fanout）。
 * @param {string} username - 测试用户名
 * @param {string} operator - operator 实体哈希
 * @param {string} text - 帖子正文
 * @param {string} [visibility='public'] - 可见性
 * @returns {Promise<object>} 已提交事件
 */
async function postAs(username, operator, text, visibility = 'public') {
	return append.commitTimelineEvent(username, operator, {
		type: 'post', content: { text, visibility, lang: 'zh-CN' },
	}, { fanout: false })
}

Deno.test('handleSocialRpc: unknown rpc type returns null', async () => {
	const { username } = await getSession()
	assertEquals(await discoverRpc.handleSocialRpc(username, { type: 'not_a_real_rpc' }), null)
})

Deno.test('handleSocialRpc: timeline_pull returns events for owner', async () => {
	const { username, operator } = await getSession()
	await postAs(username, operator, 'rpc pull post 1')
	const resp = await discoverRpc.handleSocialRpc(username, {
		type: 'social_timeline_pull_request', entityHash: operator, afterEventId: null,
	}, { requesterNodeHash: null })
	assertEquals(resp.type, 'social_timeline_pull_response')
	assertEquals(resp.entityHash, operator.toLowerCase())
	assert(resp.events.length >= 1)
})

Deno.test('federation export: private event types never leak', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'follow', content: { targetEntityHash: TARGET, rep_edge: 1 },
	}, { fanout: false })
	await append.commitTimelineEvent(username, operator, {
		type: 'like', content: { targetEntityHash: TARGET, targetPostId: 'c'.repeat(64) },
	}, { fanout: false })

	const all = await append.readTimelineEvents(username, operator)
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	const exportedTypes = new Set(exported.map(e => e.type))
	for (const priv of ['follow', 'unfollow', 'follow_approve', 'file_share'])
		assert(!exportedTypes.has(priv), `private type ${priv} must not be exported`)
	// like 默认 publishReactions=true 时可导出；隐私关闭时不导出
	assert(exportedTypes.has('like'), 'public reactions export when publishReactions defaults true')

	const tasteStore = await import('../../src/taste/store.mjs')
	await tasteStore.saveTaste(username, operator, {
		...tasteStore.emptyTasteStore(),
		privacy: { publishPreferences: true, publishReactions: false },
	})
	const exportedPrivate = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	assert(!exportedPrivate.some(e => e.type === 'like'), 'like hidden when publishReactions=false')
})

Deno.test('federation export: followers-only post hidden from anonymous requester', async () => {
	const { username, operator } = await getSession()
	const pub = await postAs(username, operator, 'public visible', 'public')
	const foll = await postAs(username, operator, 'followers only secret', 'followers')
	const all = await append.readTimelineEvents(username, operator)
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	const ids = new Set(exported.map(e => e.id))
	assert(ids.has(pub.id), 'public post should be exported')
	assert(!ids.has(foll.id), 'followers-only post should be hidden from anonymous')
})

Deno.test('federation export: social_meta hidden when timeline protected', async () => {
	const { username, operator } = await getSession()
	await socialMeta.updateSocialMeta(username, operator, { hideFromDiscovery: true })
	const all = await append.readTimelineEvents(username, operator)
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	assert(!exported.some(e => e.type === 'social_meta'), 'social_meta hidden for protected timeline to anon')
	await socialMeta.updateSocialMeta(username, operator, { hideFromDiscovery: false })
})

Deno.test('buildFederatedTimelinePullResponse honors afterEventId cursor', async () => {
	const { username, operator } = await getSession()
	const all = await append.readTimelineEvents(username, operator)
	const firstId = all[0].id
	const fromStart = await sync.buildFederatedTimelinePullResponse(username, operator, null, null)
	const afterFirst = await sync.buildFederatedTimelinePullResponse(username, operator, firstId, null)
	assert(afterFirst.length < fromStart.length, 'cursor should reduce returned set')
})

Deno.test('discoverFollowGraph: protected foreign timeline hides following from non-owner', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('1'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: true, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: TARGET, rep_edge: 1 } },
	])

	const hidden = await discoverLocal.discoverFollowGraph(username, foreignOwner, { requesterNodeHash: 'b'.repeat(64) })
	assertEquals(hidden.length, 0, 'non-owner sees empty following for protected timeline')
})

Deno.test('discoverFollowGraph: public foreign timeline exposes following', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('2'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: TARGET, rep_edge: 1 } },
	])

	const visible = await discoverLocal.discoverFollowGraph(username, foreignOwner, { requesterNodeHash: 'b'.repeat(64) })
	assert(visible.includes(TARGET.toLowerCase()), 'public timeline following visible to anyone')
})

Deno.test('discoverAccounts skips protected timelines', async () => {
	const { username, operator } = await getSession()
	const before = await discoverLocal.discoverAccounts(username, { n: 50 })
	assert(before.accounts.some(a => a.entityHash === operator.toLowerCase()), 'operator listed when public')
	await socialMeta.updateSocialMeta(username, operator, { hideFromDiscovery: true })
	const after = await discoverLocal.discoverAccounts(username, { n: 50 })
	assert(!after.accounts.some(a => a.entityHash === operator.toLowerCase()), 'protected operator hidden')
	await socialMeta.updateSocialMeta(username, operator, { hideFromDiscovery: false })
})

Deno.test('buildProfileFeedItems returns own posts', async () => {
	const { username, operator } = await getSession()
	const { items } = await feed.buildProfileFeedItems(username, operator)
	assert(items.length >= 1)
	assert(items.every(item => item.entityHash === operator.toLowerCase()))
})

Deno.test('buildHomeFeed includes own public posts', async () => {
	const { username } = await getSession()
	const { items } = await feed.buildHomeFeed(username, { limit: 50 })
	assert(items.length >= 1, 'home feed should include operator self posts')
})

Deno.test('follow then seeded remote post is pullable via federation RPC', async () => {
	const { username, operator } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('f'.repeat(64), subject)
	await following.setFollow(username, operator, remoteOwner, true)
	const [post] = await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'post', content: { text: 'follow fanout replica', visibility: 'public' } },
	])
	const resp = await discoverRpc.handleSocialRpc(username, {
		type: 'social_timeline_pull_request', entityHash: remoteOwner, afterEventId: null,
	}, { requesterNodeHash: null })
	assertEquals(resp.type, 'social_timeline_pull_response')
	assert(resp.events.some(e => e.id === post.id), 'followed remote post reachable after replica ingest')
	await following.setFollow(username, operator, remoteOwner, false)
})

Deno.test('remote author profile + posts do not break feed/discover', async () => {
	const { username, operator } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('3'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'post', content: { text: 'remote authored post', visibility: 'public' } },
	])

	const entityProfile = await import('../../src/lib/entityProfile.mjs')
	const profile = await entityProfile.getEntityProfile(username, remoteOwner)
	assert(profile, 'remote profile should resolve to derived defaults')

	await following.setFollow(username, operator, remoteOwner, true)
	const { items } = await feed.buildHomeFeed(username, { limit: 50 })
	assert(items.some(item => item.entityHash === remoteOwner.toLowerCase()), 'remote post visible in home feed')

	const discovered = await discoverLocal.discoverAccounts(username, { n: 50 })
	assert(discovered.accounts.some(a => a.entityHash === remoteOwner.toLowerCase()), 'remote public account discoverable')
	await following.setFollow(username, operator, remoteOwner, false)
})

Deno.test('discoverAccounts: ingress RPC lists only self-hosted entities', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
	])

	const localView = await discoverLocal.discoverAccounts(username, { n: 50 })
	assert(localView.accounts.some(a => a.entityHash === remoteOwner.toLowerCase()), 'local explore sees synced remote owner')

	const rpcResp = await discoverRpc.handleSocialRpc(username, {
		type: 'social_discover_request', n: 50,
	}, { requesterNodeHash: 'b'.repeat(64) })
	assert(!rpcResp.accounts.some(a => a.entityHash === remoteOwner.toLowerCase()), 'ingress RPC hides foreign synced timeline')
})

Deno.test('remote entity profile uses subjectHash placeholder not local persona', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('5'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
	])

	const { resolvePersonaPresentation } = await import('fount/public/parts/shells/chat/src/entity/presentation.mjs')
	const personaName = (await resolvePersonaPresentation(username)).displayName
	const entityProfile = await import('../../src/lib/entityProfile.mjs')
	const profile = await entityProfile.getEntityProfile(username, remoteOwner)
	const placeholder = `${subject.slice(0, 8)}…${subject.slice(-4)}`
	assert(profile?.name === placeholder, 'remote profile falls back to subjectHash placeholder')
	assert(profile?.name !== personaName, 'remote profile must not reuse local persona name')
})
