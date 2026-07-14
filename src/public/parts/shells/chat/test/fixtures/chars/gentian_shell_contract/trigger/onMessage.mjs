import { setCared } from 'fount/public/parts/shells/chat/src/chat/lib/care.mjs'
import { ensureLocalAgentEntityHash } from 'fount/public/parts/shells/chat/src/chat/lib/entity.mjs'
import { resolveOperatorEntityHash } from 'fount/public/parts/shells/chat/src/chat/lib/replica.mjs'

import { handleOwnerCommands } from './commands.mjs'
import { extractMessageText, resolveMessageContext } from './helpers.mjs'

const CHARNAME = 'gentian_shell_contract'

/** @type {string} */
let selfEntityHash = ''
/** @type {string} */
let operatorEntityHash = ''

/**
 * @param {Parameters<NonNullable<import('fount/decl/charAPI.ts').CharAPI_t['interfaces']['chat']['OnMessage']>>[0]} event OnMessage 事件
 * @returns {Promise<boolean>} 是否愿意回复
 */
export async function OnMessage(event) {
	if (!selfEntityHash) return false

	const memory = event.chatReplyRequest.chat_scoped_char_memory ??= {}
	const content = extractMessageText(event.message)
	const platform = event.chatReplyRequest.extension?.bridge?.platform || 'chat'
	const { isFromOwner, client, message } =
		await resolveMessageContext(event, selfEntityHash, operatorEntityHash)

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
	if (commandResult === 'handled' || commandResult === 'exit') return false

	return false
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

/**
 *
 */
export { selfEntityHash, operatorEntityHash, CHARNAME }
