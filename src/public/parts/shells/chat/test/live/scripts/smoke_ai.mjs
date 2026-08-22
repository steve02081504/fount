import { sleep } from 'fount/scripts/test/core/wait.mjs'
import { createSingleNodeProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const { chatApiJson, testCase, completeLiveScript } = await createSingleNodeProbe()

console.log('=== Setup: create group & add char noai_locale_reporter ===')
const group = await chatApiJson('POST', '/groups/', { name: 'AI测试群', defaultChannelName: '综合' })
const { groupId } = group
const channelId = group.defaultChannelId
await chatApiJson('POST', `/groups/${groupId}/char`, { charname: 'noai_locale_reporter' })

await testCase('AI char reply follows user message locale (zh-CN) and is not marked edited', async () => {
	await chatApiJson('POST', `/groups/${groupId}/channels/${channelId}/messages`, {
		content: { content: '请说点什么', locale: 'zh-CN' },
	})
	await chatApiJson('POST', `/groups/${groupId}/channels/${channelId}/trigger-reply`, { charname: 'noai_locale_reporter' })

	let reply = null
	for (let attemptIndex = 0; attemptIndex < 10; attemptIndex++) {
		await sleep(2000)
		const list = await chatApiJson('GET', `/groups/${groupId}/channels/${channelId}/messages?limit=20`)
		const charRows = list.messages?.filter(row => row.charId && !row.content?.is_generating) ?? []
		if (charRows.length >= 1) {
			reply = charRows[charRows.length - 1]
			break
		}
		console.log(`poll #${attemptIndex} (${list.messages?.length ?? 0} messages, waiting for char...)`)
	}
	if (!reply) return false
	if (reply.wasEdited) {
		console.log('  note  char reply marked as edited (wasEdited=true)')
		return false
	}
	if (String(reply.content?.content || '') !== '【中文回复】') {
		console.log(`  note  char reply not localized: ${String(reply.content?.content || '').slice(0, 60)}`)
		return false
	}
	return true
})

console.log('\n=== PASS smoke_ai ===')
completeLiveScript()
