/**
 * 可见性扩展 + 相册链接合集集成测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession({ username: 'social-vis-album-user' })

Deno.test('private post encrypts with pkw and owner can decrypt', async () => {
	const { username, operator } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username, operator)
	const post = await client.post({ text: 'only me', visibility: 'private' })
	const view = await import('../../src/timeline/materialize.mjs').then(m => m.getTimelineMaterialized(username, operator))
	const row = view.postById[post.event.id]
	assertEquals(row.content.scheme, 'pkw')
	assertEquals(row.content.visibility, 'private')
	const got = await client.getPost(operator, post.event.id)
	assertEquals(got.content?.text || got.event?.content?.text, 'only me')
})

Deno.test('album create / addPost derives post visibility and feed albums field', async () => {
	const { username, operator } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username, operator)
	const { albumId } = await client.albums.create({
		name: 'Friends',
		visibility: 'followers',
	})
	const post = await client.post({
		text: 'in album',
		visibility: 'public',
		mediaRefs: [{ kind: 'image', url: 'https://example.com/a.jpg' }],
		albumIds: [albumId],
	})
	const view = await import('../../src/timeline/materialize.mjs').then(m => m.getTimelineMaterialized(username, operator))
	assertEquals(view.albums[albumId].postIds.includes(post.event.id), true)
	const plain = await import('../../src/vault_crypto/vault.mjs')
		.then(m => m.maybeDecryptPostContent(username, operator, view.postById[post.event.id].content, operator))
	assertEquals(plain?.visibility, 'followers')

	const { items } = await import('../../src/feed/home.mjs').then(m => m.buildProfileFeedItems(username, operator))
	const item = items.find(row => row.postId === post.event.id)
	assert(item)
	assert(item.albums?.some(album => album.albumId === albumId))
})

Deno.test('album update tightens member post visibility via reconcile', async () => {
	const { username, operator } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username, operator)
	const { albumId } = await client.albums.create({ name: 'Tight', visibility: 'public' })
	const post = await client.post({
		text: 'will tighten',
		visibility: 'public',
		mediaRefs: [{ kind: 'image', url: 'https://example.com/b.jpg' }],
		albumIds: [albumId],
	})
	await client.albums.update(albumId, { visibility: 'private' })
	const view = await import('../../src/timeline/materialize.mjs').then(m => m.getTimelineMaterialized(username, operator))
	const row = view.postById[post.event.id]
	assertEquals(row.content.visibility, 'private')
	assertEquals(row.content.scheme, 'pkw')
})

Deno.test('album delete links keeps posts; deletePosts removes them', async () => {
	const { username, operator } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username, operator)
	const a = await client.albums.create({ name: 'KeepPosts', visibility: 'public' })
	const postA = await client.post({
		text: 'keep me',
		mediaRefs: [{ kind: 'image', url: 'https://example.com/c.jpg' }],
		albumIds: [a.albumId],
	})
	await client.albums.delete(a.albumId, { deletePosts: false })
	let view = await import('../../src/timeline/materialize.mjs').then(m => m.getTimelineMaterialized(username, operator))
	assert(!view.albums[a.albumId] || view.albums[a.albumId]?.virtual)
	assert(view.postById[postA.event.id])

	const b = await client.albums.create({ name: 'Nuke', visibility: 'public' })
	const postB = await client.post({
		text: 'delete me',
		mediaRefs: [{ kind: 'image', url: 'https://example.com/d.jpg' }],
		albumIds: [b.albumId],
	})
	await client.albums.delete(b.albumId, { deletePosts: true })
	view = await import('../../src/timeline/materialize.mjs').then(m => m.getTimelineMaterialized(username, operator))
	assert(!view.postById[postB.event.id])
})

Deno.test('unlisted posts are not public-discoverable', async () => {
	const { username, operator } = await getSession()
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username, operator)
	await client.post({ text: 'unlisted secret discover', visibility: 'unlisted' })
	const { discoverPosts } = await import('../../src/discover/local.mjs')
	const { posts } = await discoverPosts(username, { n: 50 })
	assert(!posts.some(row => String(row.textSnippet || row.text || '').includes('unlisted secret discover')))
})
