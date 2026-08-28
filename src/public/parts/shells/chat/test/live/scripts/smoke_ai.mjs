import { sleep } from 'fount/scripts/test/core/wait.mjs'
import { createSingleNodeProbe } from 'fount/scripts/test/live/singleNode/helpers.mjs'

const { chatApiJson, testCase, completeLiveScript } = await createSingleNodeProbe()

console.log('=== Setup: create group & add char noai_locale_reporter ===')
const { groupId, defaultChannelId: channelId } = await chatApiJson('POST', '/groups/', { name: 'AI测试群', defaultChannelName: '综合' })
await chatApiJson('POST', `/groups/${groupId}/char`, { charname: 'noai_locale_reporter' })

await testCase('AI char reply follows user message locale (zh-CN) and is not marked edited', async () => {
	// isAutoTrigger 抑制入站触发管线（runTriggerPipeline），确保只由下方显式 trigger-reply 产生一次回复
	await chatApiJson('POST', `/groups/${groupId}/channels/${channelId}/messages`, {
		content: { content: '请说点什么', locale: 'zh-CN', extension: { chat: { isAutoTrigger: true } } },
	})
	await chatApiJson('POST', `/groups/${groupId}/channels/${channelId}/trigger-reply`, { charname: 'noai_locale_reporter' })

	let reply = null
	for (let attemptIndex = 0; attemptIndex < 10; attemptIndex++) {
		await sleep(2000)
		const list = await chatApiJson('GET', `/groups/${groupId}/channels/${channelId}/messages?limit=20`)
		const replyRows = list.messages?.filter(row =>
			row.charId
			&& !row.content?.is_generating
			&& row.content?.content === '【中文回复】') ?? []
		if (replyRows.length >= 1) {
			reply = replyRows[replyRows.length - 1]
			break
		}
		console.log(`poll #${attemptIndex} (${list.messages?.length ?? 0} messages, waiting for char...)`)
	}
	if (!reply) return false
	if (reply.wasEdited) {
		console.log('  note  char reply marked as edited (wasEdited=true)')
		return false
	}
	// 终稿稳定后必须恰好一行且非生成中（覆盖生成占位未终稿 / 重复行的回归）
	const finalRows = await (async () => {
		for (let attemptIndex = 0; attemptIndex < 10; attemptIndex++) {
			await sleep(1000)
			const list = await chatApiJson('GET', `/groups/${groupId}/channels/${channelId}/messages?limit=20`)
			const rows = list.messages?.filter(row =>
				row.charId
				&& !row.content?.is_generating
				&& row.content?.content === '【中文回复】') ?? []
			if (rows.length === 1) return rows
			console.log(`stability poll #${attemptIndex} (char reply rows: ${rows.length})`)
		}
		return null
	})()
	if (!finalRows) {
		console.log('  note  final char reply not stable (duplicate rows or still generating)')
		return false
	}
	return true
})

console.log('\n=== PASS smoke_ai ===')
completeLiveScript()
