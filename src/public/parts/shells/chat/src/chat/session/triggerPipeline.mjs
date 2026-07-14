import { normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { getState } from '../dag/materialize.mjs'
import { agentEntityHash } from '../lib/entity.mjs'
import { messageMentionsEntity } from '../lib/mentionFacts.mjs'
import { groupKindFromState } from '../lib/notifyPrefs.mjs'
import { getLocalNodeHash } from '../lib/replica.mjs'


import { dispatchCharError } from './charError.mjs'
import { getMaterializedSession } from './dagSession.mjs'
import { getCharListOfGroup } from './partConfig.mjs'
import {
	autoReplyBucketKey,
	buildOnMessageEvent,
	consumeAutoReplyToken,
	loadAutoReplySettings,
	tickAutoReplyFrequency,
} from './replyThrottle.mjs'
import { resolveChar } from './resolvePart.mjs'
import { isCharReplyInFlight, pickNextCharForReply, triggerCharReply } from './triggerReply.mjs'

/**
 * @param {object} session 物化 session
 * @param {string} charname 角色名
 * @param {string} nodeHash 本节点 hash
 * @returns {string | null} agent entityHash
 */
function charAgentEntityHash(session, charname, nodeHash) {
	const bind = session.chars?.[charname]
	if (!bind) return null
	const home = normalizeHex64(bind.homeNodeHash) || nodeHash
	return agentEntityHash(home, `chars/${charname}`).toLowerCase()
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {object} event onMessage 事件（已构建）
 * @param {boolean} mentioned 是否被 @
 * @param {{ enabled: boolean, burst: number, refill: number, frequency: number }} settings 节流配置
 * @param {boolean} isDm 是否 DM 群
 * @param {number} charCount 群内 char 数
 * @returns {Promise<boolean>} 发言意愿
 */
async function resolveCharReplyWill(username, groupId, channelId, charname, event, mentioned, settings, isDm, charCount) {
	const char = await resolveChar(groupId, charname, username)
	if (!char) return false
	const bucketKey = autoReplyBucketKey(groupId, channelId, charname)

	if (char.interfaces?.chat?.onMessage) {
		let spoke = false
		try {
			spoke = await char.interfaces.chat.onMessage(event)
		}
		catch (error) {
			await dispatchCharError(char, error, {
				username,
				source: 'onMessage',
				groupId,
				channelId,
				charname,
				event,
			})
			return false
		}
		if (!spoke) return false
		if (settings.enabled && !mentioned) {
			const { allowed } = consumeAutoReplyToken(bucketKey, settings)
			if (!allowed) return false
		}
		return true
	}

	if (mentioned || charCount === 1 || isDm) return true
	if (settings.frequency > 0 && !mentioned)
		return tickAutoReplyFrequency(groupId, channelId, settings.frequency)
	return false
}

/**
 * @param {Error} error 触发失败原因
 */
function logTriggerCharReplyFailure(error) {
	if (error?.http_code === 404 && String(error?.message || '').includes('char not found')) return
	console.error('runTriggerPipeline triggerCharReply failed:', error)
}

/**
 * 入站消息触发管线：意愿 → 节流 → 裁决。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {{ mentions: object }} options mentions 结构
 * @returns {Promise<void>}
 */
export async function runTriggerPipeline(username, groupId, channelId, messageLine, options) {
	const content = messageLine?.content
	if (content?.isAutoTrigger || messageLine?.charId || content?.role === 'char') return

	const chars = await getCharListOfGroup(groupId, username)
	if (!chars.length) return

	const mentions = options.mentions || { entityHashes: [], roleIds: [], everyone: false }
	const session = await getMaterializedSession(username, groupId)
	const nodeHash = getLocalNodeHash()
	const settings = await loadAutoReplySettings(username, groupId)
	const { state } = await getState(username, groupId)
	const isDm = groupKindFromState(state) === 'dm'

	/** @type {string[]} */
	const mentionedChars = []
	/** @type {Array<{ charname: string, frequency: number }>} */
	const willing = []

	for (const charname of chars) {
		const agentHash = charAgentEntityHash(session, charname, nodeHash)
		const event = await buildOnMessageEvent(username, groupId, channelId, charname, { messageLine, mentions })
		const mentioned = agentHash ? await messageMentionsEntity(event, agentHash) : false
		const wantsReply = await resolveCharReplyWill(
			username, groupId, channelId, charname, event,
			mentioned, settings, isDm, chars.length,
		)
		if (!wantsReply) continue
		if (mentioned) mentionedChars.push(charname)
		else willing.push({ charname, frequency: 1 })
	}

	for (const charname of mentionedChars) {
		if (isCharReplyInFlight(groupId, channelId, charname)) continue
		void triggerCharReply(groupId, channelId, charname).catch(logTriggerCharReplyFailure)
	}

	if (!willing.length) return
	const next = pickNextCharForReply(willing)
	if (!next || isCharReplyInFlight(groupId, channelId, next)) return
	void triggerCharReply(groupId, channelId, next).catch(logTriggerCharReplyFailure)
}
