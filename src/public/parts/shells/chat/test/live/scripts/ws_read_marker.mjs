// Chat WebSocket read_marker push after HTTP PUT.
import process from 'node:process'

import { ms } from 'fount/scripts/ms.mjs'
import { liveWsBaseUrl } from 'fount/scripts/test/live/env.mjs'
import { createLiveShellHttp, waitForWsFrame } from 'fount/scripts/test/live/wsHarness.mjs'

const { chatApi, key: apiKey } = createLiveShellHttp()

const createdGroup = await chatApi('POST', '/groups/', { name: 'WSReadMarker' })
const groupId = createdGroup.json.groupId
const channelId = createdGroup.json.defaultChannelId
const peers = await chatApi('GET', `/groups/${groupId}/peers`)
const nodeHash = peers.json.selfNodeHash

const post = await chatApi('POST', `/groups/${groupId}/channels/${channelId}/messages`, {
	content: { type: 'text', content: 'read-marker-live' },
})
const eventId = post.json?.event?.id
const seq = post.json?.event?.seq
if (post.status !== 201 || !eventId) {
	console.error('FAIL: post message', post.status, post.json)
	process.exit(1)
}

const wsUrl = `${liveWsBaseUrl()}/ws/parts/shells:chat/groups/${nodeHash}/${groupId}?fount-apikey=${encodeURIComponent(apiKey)}`
const markerRun = await waitForWsFrame({
	url: wsUrl,
	types: ['read_marker'],
	timeoutMs: ms('20s'),
	/** PUT read-marker 以触发 WS 推送。 */
	trigger: async () => {
		const marker = await chatApi('PUT', `/groups/${groupId}/channels/${channelId}/read-marker`, {
			eventId,
			seq: Number(seq) || 1,
		})
		if (marker.status !== 200) throw new Error(`read-marker failed ${marker.status}`)
	},
})

await chatApi('DELETE', `/groups/${groupId}`)
if (!markerRun.ok) {
	console.error('FAIL: read_marker push', markerRun.types)
	process.exit(1)
}
console.log('PASS: read_marker push', markerRun.types)
process.exit(0)
