import { createSingleNodeProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const { chatApiJson } = await createSingleNodeProbe()

console.log('=== 1. Create group ===')
const g = await chatApiJson('POST', '/groups/', {
	name: 'SmokeTest群',
	description: '冒烟测试',
	defaultChannelName: '综合',
})
console.log(JSON.stringify(g, null, 2))
const groupId = g.groupId
const channelId = g.defaultChannelId
console.log(`groupId=${groupId} channelId=${channelId}`)

console.log('\n=== 2. Group state ===')
const state = await chatApiJson('GET', `/groups/${groupId}/state`)
console.log(JSON.stringify(state, null, 2))

console.log('\n=== 3. Send message ===')
const m = await chatApiJson('POST', `/groups/${groupId}/channels/${channelId}/messages`, {
	content: { type: 'text', content: '你好，这是第一条冒烟测试消息' },
})
console.log(JSON.stringify(m, null, 2))

console.log('\n=== 4. Read messages ===')
const msgs = await chatApiJson('GET', `/groups/${groupId}/channels/${channelId}/messages?limit=20`)
console.log(JSON.stringify(msgs, null, 2))

console.log(`\n=== DONE === groupId=${groupId} channelId=${channelId}`)
