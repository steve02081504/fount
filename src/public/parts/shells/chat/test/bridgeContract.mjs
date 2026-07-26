/**
 * 虚拟桥接 OnMessage 契约断言（三平台 integration 复用）。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

/**
 * @param {object} event OnMessage 事件
 * @param {{ platform: string, chatKind?: 'dm' | 'group', expectCharUid?: string }} expect 期望
 * @returns {void}
 */
export function assertOnMessageEventShape(event, expect) {
	assert(event?.chatReplyRequest, 'chatReplyRequest missing')
	assert(event?.message, 'message missing')
	assert(event?.group, 'group missing')
	assert(event?.channel, 'channel missing')
	assert(Array.isArray(event.chatReplyRequest.chat_log), 'chat_log must be array')
	assertEquals(typeof event.message.content, 'string', 'OnMessage message.content must be fount string')
	assertEquals(event.group.bridge?.platform, expect.platform)
	if (expect.chatKind)
		assertEquals(event.group.kind, expect.chatKind === 'dm' ? 'dm' : 'group')
	assert(event.message.extension?.chat?.bridge?.authorEntityHash
		|| event.message.uid, 'author identity missing on message')
	if (expect.expectCharUid)
		assertEquals(
			String(event.chatReplyRequest.CharUid || '').toLowerCase(),
			String(expect.expectCharUid).toLowerCase(),
		)
}

/**
 * @param {object[]} chatLog 虚拟 log
 * @param {string} charUid 角色 entityHash
 * @returns {object} 最近角色行
 */
export function assertCharReplyRowContract(chatLog, charUid) {
	const charRow = [...chatLog || []].reverse().find(row => row.role === 'char')
	assert(charRow, 'char reply row missing in chat_log')
	assertEquals(charRow.role, 'char')
	assertEquals(String(charRow.uid || '').toLowerCase(), String(charUid).toLowerCase())
	assertEquals(charRow.extension?.charId, undefined, 'extension.charId must not be set')
	assertEquals(typeof charRow.content, 'string')
	return charRow
}

/**
 * 回填行必须排在触发消息之前；触发消息之后只允许角色回复。
 * @param {object[]} chatLog 虚拟 log
 * @param {string | number} triggerPlatformMessageId 触发消息平台 id
 * @returns {void}
 */
export function assertBackfillBeforeTrigger(chatLog, triggerPlatformMessageId) {
	const logs = chatLog || []
	const triggerIndex = logs.findIndex(row =>
		String(row.extension?.chat?.bridge?.platformMessageId) === String(triggerPlatformMessageId)
		&& row.extension?.chat?.ingress !== 'backfill')
	assert(triggerIndex >= 0, 'trigger message missing from chat_log')
	for (let i = 0; i < logs.length; i++) {
		if (logs[i].extension?.chat?.ingress !== 'backfill') continue
		assert(i < triggerIndex, `backfill at index ${i} must precede trigger at ${triggerIndex}`)
	}
	const lastUser = [...logs].reverse().find(row => row.role !== 'char')
	assert(lastUser, 'user trigger row missing')
	assertEquals(lastUser.extension?.chat?.ingress !== 'backfill', true, 'latest user row must not be backfill')
	assertEquals(
		String(lastUser.extension?.chat?.bridge?.platformMessageId),
		String(triggerPlatformMessageId),
		'latest user row must be the trigger message',
	)
}

/**
 * @param {object} event OnMessage 事件
 * @param {string} charUid 角色 entityHash
 * @returns {boolean} mentions 是否含 CharUid
 */
export function eventMentionsChar(event, charUid) {
	const needle = String(charUid || '').toLowerCase()
	return (event?.mentions?.entityHashes || []).some(hash => String(hash).toLowerCase() === needle)
}
