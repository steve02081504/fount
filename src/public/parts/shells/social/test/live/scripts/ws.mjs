// Social feed WebSocket: hello + post push + notification + reconnect.
import process from 'node:process'

import { ms } from 'fount/scripts/ms.mjs'
import { liveWsBaseUrl } from 'fount/scripts/test/live/env.mjs'
import { createLiveShellHttp, waitForWsFrame } from 'fount/scripts/test/live/wsHarness.mjs'

const { chatApi, key: apiKey } = createLiveShellHttp({ shell: 'chat' })
const { shellApi: socialApi } = createLiveShellHttp({ shell: 'social' })

const viewer = await chatApi('GET', '/viewer')
if (viewer.status !== 200 || !viewer.json?.viewerEntityHash) {
	console.error('FAIL: GET chat /viewer', viewer.status, viewer.json)
	process.exit(1)
}
const entityHash = viewer.json.viewerEntityHash
const wsUrl = `${liveWsBaseUrl()}/ws/parts/shells:social/feed?fount-apikey=${encodeURIComponent(apiKey)}`

const postRun = await waitForWsFrame({
	url: wsUrl,
	types: ['post'],
	timeoutMs: ms('20s'),
	/** 发帖以触发 feed post 帧。 */
	trigger: async () => {
		const post = await socialApi('POST', '/posts', {
			entityHash,
			text: `ws-push ${Date.now()}`,
			visibility: 'public',
			locale: 'zh-CN',
		})
		if (post.status !== 200) throw new Error(`post failed ${post.status}`)
	},
})
if (!postRun.ok) {
	console.error('FAIL: post push', postRun.types)
	process.exit(1)
}
console.log('PASS: post push', postRun.types)

const seedPost = await socialApi('POST', '/posts', {
	entityHash,
	text: `ws-like-target ${Date.now()}`,
	visibility: 'public',
	locale: 'zh-CN',
})
const postId = seedPost.json?.event?.id
if (seedPost.status !== 200 || !postId) {
	console.error('FAIL: seed post for notification', seedPost.status)
	process.exit(1)
}

const notificationRun = await waitForWsFrame({
	url: wsUrl,
	types: ['notification'],
	timeoutMs: ms('20s'),
	/** foreign-like 以触发 notification 帧。 */
	trigger: async () => {
		const foreignLike = await socialApi('POST', '/test/foreign-like', {
			targetEntityHash: entityHash,
			targetPostId: postId,
		})
		if (foreignLike.status !== 200) throw new Error(`foreign-like failed ${foreignLike.status}`)
	},
})
if (!notificationRun.ok) {
	console.error('FAIL: notification push', notificationRun.types)
	process.exit(1)
}
console.log('PASS: notification push', notificationRun.types)

const reconnectRun = await waitForWsFrame({
	url: wsUrl,
	types: ['hello'],
	timeoutMs: ms('10s'),
})
if (!reconnectRun.ok) {
	console.error('FAIL: reconnect hello', reconnectRun.types)
	process.exit(1)
}
console.log('PASS: reconnect hello')

process.exit(0)
