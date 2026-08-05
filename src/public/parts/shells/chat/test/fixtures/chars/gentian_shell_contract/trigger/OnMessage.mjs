import { setCared } from 'fount/public/parts/shells/chat/src/chat/lib/care.mjs'
import { messageMentionsEntity } from 'fount/public/parts/shells/chat/src/chat/lib/mentionFacts.mjs'
import { resolveOperatorEntityHash } from 'fount/public/parts/shells/chat/src/chat/lib/replica.mjs'
import { ensureLocalAgentEntityHash } from 'fount/public/parts/shells/chat/src/entity/member.mjs'
import { onMessageProbe } from 'fount/public/parts/shells/chat/test/fixtures/probes/onMessageProbe.mjs'

import { handleOwnerCommands } from './commands.mjs'
import { extractMessageText, resolveMessageContext } from './helpers.mjs'

const CHARNAME = 'gentian_shell_contract'

/** @type {string} */
let selfEntityHash = ''
/** @type {string} */
let operatorEntityHash = ''

/**
 * @param {object} row chat_log 行
 * @returns {boolean} 是否角色发言
 */
function rowIsFromChar(row) {
	return row?.role === 'char'
}

/**
 * @param {Parameters<NonNullable<import('fount/decl/charAPI.ts').CharAPI_t['interfaces']['chat']['OnMessage']>>[0]} event OnMessage 事件
 * @returns {Promise<boolean>} 是否愿意回复
 */
export async function OnMessage(event) {
	if (!selfEntityHash) return false

	const memory = event.chatReplyRequest.chat_scoped_char_memory ??= {}
	const content = extractMessageText(event.message)
	const platform = event.chatReplyRequest.extension?.chat?.bridge?.platform || 'chat'
	const { isFromOwner, client, message } =
		await resolveMessageContext(event, selfEntityHash)
	const mentionsBot = await messageMentionsEntity(event, selfEntityHash)
	const chatLog = event.chatReplyRequest.chat_log || []
	const hasCharReply = chatLog.some(rowIsFromChar)
	const isDm = event.group?.kind === 'dm'

	const commandResult = await handleOwnerCommands({
		content,
		memory,
		message,
		client,
		groupId: event.group.groupId,
		isFromOwner,
		platform,
		selfHash: selfEntityHash,
		username: event.chatReplyRequest.username,
	})
	if (commandResult === 'handled' || commandResult === 'exit') {
		onMessageProbe.decisions.push({
			wantsReply: false,
			reason: `command:${commandResult}`,
			isFromOwner,
			mentionsBot,
			isDm,
			hasCharReply,
		})
		onMessageProbe.events.push(event)
		return false
	}

	// 契约骨架：DM 主人 / 已有角色回复的 DM / @bot → 愿意回复；其余拒绝
	const wantsReply = (isDm && isFromOwner)
		|| (isDm && hasCharReply)
		|| mentionsBot

	onMessageProbe.decisions.push({
		wantsReply,
		reason: wantsReply
			? (isDm && isFromOwner && 'dm_owner')
			|| (isDm && hasCharReply && 'dm_followup')
			|| (mentionsBot && 'mention')
			: 'no_trigger',
		isFromOwner,
		mentionsBot,
		isDm,
		hasCharReply,
		selfEntityHash,
		charUid: event.chatReplyRequest.CharUid,
	})
	onMessageProbe.events.push(event)
	return wantsReply
}

/**
 * @param {string} replicaUsername replica
 */
export async function initTriggerIdentity(replicaUsername) {
	const selfHash = await ensureLocalAgentEntityHash(replicaUsername, CHARNAME)
	const operatorHash = (await resolveOperatorEntityHash(replicaUsername))?.toLowerCase()
	selfEntityHash = String(selfHash || '').toLowerCase()
	operatorEntityHash = String(operatorHash || '').toLowerCase()
	if (operatorHash) await setCared(replicaUsername, selfHash, operatorHash, true)
}

/** 重导出 fixture 身份常量。 */
export { selfEntityHash, operatorEntityHash, CHARNAME }
