import process from 'node:process'

import { sleep } from 'fount/scripts/test/live/http.mjs'
import { createSingleNodeProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const { chatApiJson } = await createSingleNodeProbe()

console.log('=== 1. Create group ===')
const g = await chatApiJson('POST', '/groups/', { name: 'AI测试群', defaultChannelName: '综合' })
const groupId = g.groupId
const channelId = g.defaultChannelId
console.log(`groupId=${groupId} channelId=${channelId}`)

console.log('\n=== 2. Add char test_streamer ===')
await chatApiJson('POST', `/groups/${groupId}/char`, { charname: 'test_streamer' })

console.log('\n=== 3. Send user message ===')
await chatApiJson('POST', `/groups/${groupId}/channels/${channelId}/messages`, {
	content: { type: 'text', content: '请说点什么' },
})

console.log('\n=== 4. Trigger char reply ===')
await chatApiJson('POST', `/groups/${groupId}/channels/${channelId}/trigger-reply`, { charname: 'test_streamer' })

console.log('\n=== 5. Poll for char reply (<=20s) ===')
let charReply = false
for (let i = 0; i < 10; i++) {
	await sleep(2000)
	const list = await chatApiJson('GET', `/groups/${groupId}/channels/${channelId}/messages?limit=20`)
	const charRows = list.messages?.filter(row => row.charId && !row.content?.is_generating) ?? []
	if (charRows.length >= 1) {
		charReply = true
		console.log(`  ok    char reply after poll #${i}`)
		break
	}
	console.log(`poll #${i} (${list.messages?.length ?? 0} messages, waiting for char...)`)
}
if (!charReply) {
	console.log('  FAIL  no char reply within timeout')
	process.exit(1)
}

console.log('\n=== PASS smoke_ai ===')
