import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { memberEntityHash } from '../../entity/member.mjs'
import { runOutsideGroupLocks } from '../dag/groupLock.mjs'
import { getState } from '../dag/materialize.mjs'
import { messageMentionsEntity } from '../lib/mentionFacts.mjs'
import { groupKindFromState } from '../lib/notificationPreferences.mjs'
import { getLocalNodeHash } from '../lib/replica.mjs'

import { dispatchCharError } from './charError.mjs'
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
 * @param {object} members 物化成员表
 * @param {string} charname 角色名
 * @returns {string | null} agent entityHash
 */
function charAgentEntityHash(members, charname) {
	if (!charname) return null
	for (const member of Object.values(members || {})) {
		if (member?.memberKind !== 'agent' || member.status !== 'active') continue
		if (member.charname !== charname) continue
		return memberEntityHash(member)
	}
	return null
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {object} event OnMessage 事件（已构建）
 * @param {boolean} mentioned 是否被 @
 * @param {{ enabled: boolean, burst: number, refill: number, frequency: number }} settings 节流配置
 * @param {boolean} isDm 是否 DM 群
 * @param {number} charCount 群内 char 数
 * @param {number} userCount 群内活跃真人（非 agent 成员）数
 * @returns {Promise<{ wantsReply: boolean, frequency: number | null }>} 发言意愿；`frequency` 为已调用 OnMessage 时的预计算权重（未调用为 null）
 */
async function resolveCharReplyWill(username, groupId, channelId, charname, event, mentioned, settings, isDm, charCount, userCount) {
	const char = await resolveChar(groupId, charname, username)
	if (!char) return { wantsReply: false, frequency: null }
	const bucketKey = autoReplyBucketKey(groupId, channelId, charname)

	if (char.interfaces?.chat?.OnMessage) {
		let spoke = false
		try {
			spoke = await char.interfaces.chat.OnMessage(event)
		}
		catch (error) {
			await dispatchCharError(char, error, {
				username,
				source: 'OnMessage',
				groupId,
				channelId,
				charname,
				event,
			})
			return { wantsReply: false, frequency: 0 }
		}
		if (!spoke) return { wantsReply: false, frequency: 0 }
		if (settings.enabled && !mentioned) {
			const { allowed } = consumeAutoReplyToken(bucketKey, settings)
			if (!allowed) return { wantsReply: false, frequency: 0 }
		}
		return { wantsReply: true, frequency: 1e6 }
	}

	// fallback（无 OnMessage）：仅 @ / DM / 单角色且单真人的私聊群自动回复；多真人群需 @ 或显式频率
	if (mentioned || (charCount === 1 && userCount === 1) || isDm) return { wantsReply: true, frequency: null }
	if (settings.frequency > 0 && !mentioned)
		return { wantsReply: tickAutoReplyFrequency(groupId, channelId, settings.frequency), frequency: null }
	return { wantsReply: false, frequency: null }
}

/**
 * @param {Error} error 触发失败原因
 */
function logTriggerCharReplyFailure(error) {
	if (error?.http_code === 404 && String(error?.message || '').includes('char not found')) {
		// 触发竞态下的预期 404，保持静默不进 stderr，但留 debug 转储避免无痕黑洞
		void debugLog('trigger_char_reply_404', {
			message: String(error?.message || ''),
			stack: String(error?.stack || '').split('\n').slice(0, 5).join('\n'),
		}).catch(() => { })
		return
	}
	console.error('runTriggerPipeline triggerCharReply failed:', error)
}

/**
 * 入站消息触发管线：意愿 → 节流 → 裁决。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {{ mentions: object }} options mentions 结构
 * @returns {Promise<Map<string, number> | null>} 逐角色的 OnMessage 预计算权重（供 `getCharReplyFrequency` 复用，避免重复调用）；未运行管线时为 null
 */
export async function runTriggerPipeline(username, groupId, channelId, messageLine, options) {
	const content = messageLine?.content
	const chat = content?.extension?.chat
	if (chat?.isAutoTrigger || messageLine?.charId || content?.role === 'char') return null

	const chars = await getCharListOfGroup(groupId, username)
	if (!chars.length) return null

	const mentions = options.mentions || { entityHashes: [], roleIds: [], everyone: false }
	const settings = await loadAutoReplySettings(username, groupId)
	const { state } = await getState(username, groupId)
	const isDm = groupKindFromState(state) === 'dm'
	const userCount = Object.values(state.members || {})
		.filter(member => member?.memberKind === 'user' && member?.status === 'active').length

	/** @type {string[]} */
	const mentionedChars = []
	/** @type {Array<{ charname: string, frequency: number }>} */
	const willing = []
	/** @type {Map<string, number>} 已调用 OnMessage 的角色权重（0 表拒绝，1e6 表愿意） */
	const onMessageFrequencies = new Map()

	for (const charname of chars) {
		// 非本机 char 的触发由归属节点处理；本节点跳过，避免为异地 part 强行创建本地实体身份
		const bind = state.session?.chars?.[charname]
		if (bind?.homeNodeHash && bind.homeNodeHash !== getLocalNodeHash()) continue
		const agentHash = charAgentEntityHash(state.members, charname)
		const event = await buildOnMessageEvent(username, groupId, channelId, charname, { messageLine, mentions })
		const mentioned = agentHash ? await messageMentionsEntity(event, agentHash) : false
		const { wantsReply, frequency } = await resolveCharReplyWill(
			username, groupId, channelId, charname, event,
			mentioned, settings, isDm, chars.length, userCount,
		)
		if (frequency !== null) onMessageFrequencies.set(charname, frequency)
		if (!wantsReply) continue
		if (mentioned) mentionedChars.push(charname)
		else willing.push({ charname, frequency: 1 })
	}

	// 本管线常由锁内的事件落盘副作用启动；回复生成是 fire-and-forget，必须在锁外启动，
	// 否则其占位/流式/终稿写入会继承可重入标记而绕过群写锁，与并发本机写入竞争。
	for (const charname of mentionedChars) {
		if (isCharReplyInFlight(groupId, channelId, charname)) continue
		void runOutsideGroupLocks(() => triggerCharReply(groupId, channelId, charname)).catch(logTriggerCharReplyFailure)
	}

	if (!willing.length) return onMessageFrequencies
	const next = pickNextCharForReply(willing)
	if (!next || isCharReplyInFlight(groupId, channelId, next)) return onMessageFrequencies
	void runOutsideGroupLocks(() => triggerCharReply(groupId, channelId, next)).catch(logTriggerCharReplyFailure)
	return onMessageFrequencies
}
