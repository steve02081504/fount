import { createShellProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const social = await createShellProbe('social')
const chat = await createShellProbe('chat')
const {
	shellApi,
	testCase,
	writeLiveSection,
	writeLiveSummary,
	completeLiveScript,
} = social

let entityHash = null
let postId = null
let folderId = null
let shareId = null
const dummyTarget = 'a'.repeat(128)

writeLiveSection('A. Viewer & discover')

await testCase('GET chat /viewer', async () => {
	const r = await chat.shellApi('GET', '/viewer')
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	entityHash = r.json.viewerEntityHash
	return Boolean(entityHash)
})

await testCase('GET /profile/likes', async () => {
	const r = await shellApi('GET', `/profile/${entityHash}/likes`)
	return r.status === 200 && r.json.items != null
})

await testCase('GET /feed', async () => {
	const r = await shellApi('GET', '/feed?limit=20')
	return r.status === 200 && r.json.items != null
})

await testCase('POST /feed/sync', async () => {
	const r = await shellApi('POST', '/feed/sync', null)
	return r.status === 200 && r.json.synced === true
})

await testCase('GET /explore/posts', async () => {
	const r = await shellApi('GET', '/explore/posts?limit=10')
	return r.status === 200
})

await testCase('GET /explore', async () => {
	const r = await shellApi('GET', '/explore?limit=10')
	return r.status === 200
})

await testCase('GET /hashtags/trending', async () => {
	const r = await shellApi('GET', '/hashtags/trending?limit=8')
	return r.status === 200 && r.json.tags != null
})

await testCase('GET /notifications', async () => {
	const r = await shellApi('GET', '/notifications?limit=10')
	return r.status === 200 && r.json.notifications != null
})

await testCase('GET /mentions/suggest', async () => {
	const r = await shellApi('GET', '/mentions/suggest?q=ab&limit=5')
	return r.status === 200
})

await testCase('GET /search short query 400', async () => {
	const r = await shellApi('GET', '/search?q=a')
	return r.status === 400
})

writeLiveSection('B. Profile read & post')

await testCase('POST /posts', async () => {
	const r = await shellApi('POST', '/posts', {
		entityHash,
		text: 'social e2e post',
		visibility: 'public',
		locale: 'zh-CN',
	})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	postId = r.json.event?.id
	return Boolean(postId)
})

await testCase('GET /profile/:hash', async () => {
	const r = await shellApi('GET', `/profile/${entityHash}`)
	return r.status === 200 && r.json.entityHash === entityHash
})

await testCase('GET /profile/:hash/posts', async () => {
	const r = await shellApi('GET', `/profile/${entityHash}/posts`)
	return r.status === 200 && (r.json.items?.length ?? 0) >= 1
})

await testCase('GET /profile/:hash/following', async () => {
	const r = await shellApi('GET', `/profile/${entityHash}/following`)
	return r.status === 200
})

await testCase('GET /profile/:hash/replies/:postId', async () => {
	const r = await shellApi('GET', `/profile/${entityHash}/replies/${postId}`)
	return r.status === 200
})

await testCase('GET /search hashtag', async () => {
	const r = await shellApi('GET', '/search?q=%23social')
	return r.status === 200
})

writeLiveSection('C. Interactions')

await testCase('POST /posts/:hash/:id/like', async () => {
	const r = await shellApi('POST', `/posts/${entityHash}/${postId}/like`, { like: true })
	return r.status === 200 && r.json.event?.type === 'like'
})

await testCase('POST /posts/:hash/:id/repost', async () => {
	const r = await shellApi('POST', `/posts/${entityHash}/${postId}/repost`, { comment: 'e2e repost' })
	return r.status === 200 && r.json.event?.type === 'repost'
})

await testCase('POST /relationships/follow seeded test target', async () => {
	const r = await shellApi('POST', '/relationships/follow', { entityHash: dummyTarget, follow: true })
	return r.status === 200 && r.json.isFollowing === true
})

await testCase('POST /relationships/follow unfollow seeded test target', async () => {
	const r = await shellApi('POST', '/relationships/follow', { entityHash: dummyTarget, follow: false })
	return r.status === 200 && r.json.isFollowing === false
})

await testCase('POST /profile/meta', async () => {
	const r = await shellApi('POST', '/profile/meta', { hideFromDiscovery: false })
	return r.status === 200
})

await testCase('POST /relationships/block + unblock seeded test target', async () => {
	const b = await shellApi('POST', '/relationships/block', { entityHash: dummyTarget, block: true })
	if (b.status !== 200) throw new Error(`block ${b.status}`)
	const u = await shellApi('POST', '/relationships/block', { entityHash: dummyTarget, block: false })
	return u.status === 200
})

await testCase('POST /relationships/hide + unhide seeded test target', async () => {
	const h = await shellApi('POST', '/relationships/hide', { entityHash: dummyTarget, hide: true })
	if (h.status !== 200) throw new Error(`hide ${h.status}`)
	const u = await shellApi('POST', '/relationships/hide', { entityHash: dummyTarget, hide: false })
	return u.status === 200
})

await testCase('GET chat /personal-lists', async () => {
	const r = await chat.shellApi('GET', '/personal-lists')
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	return r.json.entries != null
})

writeLiveSection('D. Saved posts')

await testCase('POST /saved-posts/folders', async () => {
	const r = await shellApi('POST', '/saved-posts/folders', { name: 'E2E Saved' })
	if (r.status !== 200) throw new Error(`status ${r.status}`)
	folderId = Object.keys(r.json.folders ?? {})[0]
	return Boolean(folderId)
})

await testCase('POST /saved-posts/add', async () => {
	const r = await shellApi('POST', '/saved-posts/add', { entityHash, postId, folderId })
	return r.status === 200
})

await testCase('GET /saved-posts', async () => {
	const r = await shellApi('GET', '/saved-posts')
	return r.status === 200
})

await testCase('POST /saved-posts/folders/rename', async () => {
	const r = await shellApi('POST', '/saved-posts/folders/rename', { folderId, name: 'E2E Starred' })
	return r.status === 200
})

await testCase('POST /saved-posts/remove', async () => {
	const r = await shellApi('POST', '/saved-posts/remove', { entityHash, postId, folderId })
	return r.status === 200
})

await testCase('POST /saved-posts/folders/delete', async () => {
	const r = await shellApi('POST', '/saved-posts/folders/delete', { folderId })
	return r.status === 200
})

writeLiveSection('D2. Composer drafts')

let draftId = ''
await testCase('POST /drafts', async () => {
	const r = await shellApi('POST', '/drafts', { text: 'E2E draft body', visibility: 'public' })
	if (r.status !== 200) throw new Error(`status ${r.status}`)
	draftId = r.json.draftId
	return Boolean(draftId)
})

await testCase('GET /drafts', async () => {
	const r = await shellApi('GET', '/drafts')
	return r.status === 200 && (r.json.drafts || []).some(row => row.draftId === draftId)
})

await testCase('GET /drafts/:draftId', async () => {
	const r = await shellApi('GET', `/drafts/${draftId}`)
	return r.status === 200 && r.json.body?.text === 'E2E draft body'
})

await testCase('POST /drafts update', async () => {
	const r = await shellApi('POST', '/drafts', { draftId, text: 'E2E draft edited', visibility: 'unlisted' })
	return r.status === 200 && r.json.body?.text === 'E2E draft edited'
})

await testCase('DELETE /drafts/:draftId', async () => {
	const r = await shellApi('DELETE', `/drafts/${draftId}`)
	return r.status === 200 && !(r.json.drafts || []).some(row => row.draftId === draftId)
})

writeLiveSection('E. Vault & translate')

await testCase('POST /translate', async () => {
	const r = await shellApi('POST', '/translate', { text: 'hello world', targetLang: 'zh-CN' })
	return r.status === 200 && r.json.translated != null
})

await testCase('POST /files register', async () => {
	const r = await shellApi('POST', '/files', {
		fileId: 'e2e-file-001',
		logicalPath: 'shells/social/vault/e2e-file-001',
		name: 'e2e.txt',
		mimeType: 'text/plain',
		size: 4,
		visibility: 'public',
		shareId: 'e2e-share-001',
	})
	if (r.status !== 200) throw new Error(`status ${r.status}: ${r.raw}`)
	shareId = r.json.entry?.shareId
	return Boolean(shareId)
})

await testCase('GET /files/:shareId', async () => {
	const r = await shellApi('GET', `/files/${shareId}`)
	return r.status === 200 && r.json.entry?.shareId === shareId
})

writeLiveSection('F. Cleanup')

await testCase('DELETE /posts', async () => {
	const r = await shellApi('DELETE', '/posts', { postId })
	return r.status === 200 && r.json.event?.type === 'post_delete'
})

writeLiveSummary('social e2e_single')
completeLiveScript()
