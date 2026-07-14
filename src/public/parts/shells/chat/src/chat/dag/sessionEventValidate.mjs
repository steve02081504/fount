/**
 * 【文件】`dag/sessionEventValidate.mjs` — `session_*` / 本地元数据 DAG 事件内容校验。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { isChannelIdValid } from '../lib/channelId.mjs'

const WORLD_DISTRIBUTIONS = new Set(['local', 'replicated', 'hosted'])

/**
 * 校验 session_world_bind / session_world_bind_channel 的 distribution 与 homeNodeHash 规则。
 * @param {object} content 事件 content
 * @param {string} label 错误前缀
 * @returns {void}
 */
function validateWorldBindContent(content, label) {
	if (!content.worldname?.trim()) throw new Error(`${label}: worldname required`)
	if (!content.ownerUsername?.trim()) throw new Error(`${label}: ownerUsername required`)
	const distribution = content.distribution?.trim() || 'hosted'
	if (content.distribution != null && content.distribution !== '' && !WORLD_DISTRIBUTIONS.has(distribution))
		throw new Error(`${label}: invalid distribution`)
	if (distribution !== 'local' && !content.homeNodeHash?.trim())
		throw new Error(`${label}: homeNodeHash required`)
}

/**
 * 校验 session_* / agent_reply_frequency_set DAG 事件 content 形状（联邦入站）。
 * @param {object} event 事件体
 * @returns {void}
 */
export function validateSessionEventContent(event) {
	const content = event?.content || {}
	switch (event.type) {
		case 'agent_reply_frequency_set': {
			// state.members 以 64-hex pubKeyHash 为键（见 reducers/members.mjs、canonicalizeEvent）。
			const targetMemberKey = String(content.targetMemberKey || '').trim().toLowerCase()
			if (!isHex64(targetMemberKey))
				throw new Error('agent_reply_frequency_set: targetMemberKey required')
			if (!Number.isFinite(Number(content.frequency)))
				throw new Error('agent_reply_frequency_set: frequency required')
			break
		}
		case 'session_world_bind': {
			validateWorldBindContent(content, 'session_world_bind')
			break
		}
		case 'session_world_bind_channel': {
			if (!isChannelIdValid(content.channelId)) throw new Error('session_world_bind_channel: channelId required')
			validateWorldBindContent(content, 'session_world_bind_channel')
			break
		}
		case 'session_world_clear': {
			if (content.channelId != null && !isChannelIdValid(content.channelId))
				throw new Error('session_world_clear: invalid channelId')
			break
		}
		case 'session_persona_set': {
			if (!content.ownerUsername?.trim()) throw new Error('session_persona_set: ownerUsername required')
			break
		}
		case 'session_plugin_add':
		case 'session_plugin_remove': {
			if (!content.ownerUsername?.trim()) throw new Error(`${event.type}: ownerUsername required`)
			if (!content.pluginname?.trim()) throw new Error(`${event.type}: pluginname required`)
			break
		}
		default:
			break
	}
}
