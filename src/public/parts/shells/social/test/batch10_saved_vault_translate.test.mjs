/**
 * Batch 10：收藏 / vault 索引 / 翻译缓存。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/social/test/batch10_saved_vault_translate.test.mjs
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap } from './harness.mjs'

const { username, operator } = await bootstrap()

const append = await import('../src/timeline/append.mjs')
const saved = await import('../src/savedPosts.mjs')
const vaultRoot = await import('../src/vault.mjs')
const translate = await import('../src/translate.mjs')

let postId = null

Deno.test('saved posts folder CRUD', async () => {
	const signed = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'saved target', visibility: 'public' },
	}, { fanout: false })
	postId = signed.id

	const created = await saved.createSavedFolder(username, 'Favorites')
	const folderId = Object.keys(created.folders).find(id => created.folders[id].name === 'Favorites')
	assert(folderId)

	let data = await saved.addSavedPost(username, { entityHash: operator, postId }, folderId)
	assert(data.folders[folderId].posts.some(r => r.postId === postId))

	await saved.renameSavedFolder(username, folderId, 'Starred')
	data = await saved.loadSavedPosts(username)
	assertEquals(data.folders[folderId].name, 'Starred')

	data = await saved.removeSavedPost(username, { entityHash: operator, postId }, folderId)
	assertEquals(data.folders[folderId].posts.length, 0)

	data = await saved.addSavedPost(username, { entityHash: operator, postId }, null)
	assert(data.unfiled.some(r => r.postId === postId))

	data = await saved.deleteSavedFolder(username, folderId)
	assert(!data.folders[folderId])
	assert(data.unfiled.some(r => r.postId === postId))

	await saved.removeSavedPost(username, { entityHash: operator, postId })
})

Deno.test('registerVaultFile and getVaultFileByShareId', async () => {
	const shareId = 'share-test-001'
	const entry = await vaultRoot.registerVaultFile(username, operator, {
		fileId: 'file-test-001',
		logicalPath: 'shells/social/vault/file-test-001',
		name: 'note.txt',
		mimeType: 'text/plain',
		size: 12,
		shareId,
		visibility: 'followers',
	})
	assertEquals(entry.shareId, shareId)

	const found = await vaultRoot.getVaultFileByShareId(username, operator, shareId)
	assert(found)
	assertEquals(found.name, 'note.txt')
})

Deno.test('translate cache hit and miss', async () => {
	const key = 'zh-CN:cache test phrase'
	assertEquals(translate.getCachedTranslation(username, key), null)
	translate.cacheTranslation(username, key, 'cached translation')
	assertEquals(translate.getCachedTranslation(username, key), 'cached translation')
})

Deno.test('translatePostText returns original when no generator', async () => {
	const out = await translate.translatePostText('plain text', 'en')
	assertEquals(out, 'plain text')
})
