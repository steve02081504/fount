/**
 * 【文件】`dag/sessionEventValidate.mjs` — `session_*` / 本地元数据 DAG 事件内容校验。
 */
import { isEntityHash128 } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { isChannelIdValid } from '../lib/channelId.mjs'

/**
 * 校验 session_* / agent_reply_frequency_set DAG 事件 content 形状（联邦入站）。
 * @param {object} event 事件体
 * @returns {void}
 */
export function validateSessionEventContent(event) {
	const content = event?.content || {}
	switch (event.type) {
		case 'agent_reply_frequency_set': {
			const targetMemberKey = String(content.targetMemberKey || '').trim().toLowerCase()
			if (!isEntityHash128(targetMemberKey))
				throw new Error('agent_reply_frequency_set: targetMemberKey required')
			if (!Number.isFinite(Number(content.frequency)))
				throw new Error('agent_reply_frequency_set: frequency required')
			break
		}
		case 'session_world_bind': {
			if (!content.worldname?.trim()) throw new Error('session_world_bind: worldname required')
			if (!content.ownerUsername?.trim()) throw new Error('session_world_bind: ownerUsername required')
			if (!content.homeNodeHash?.trim()) throw new Error('session_world_bind: homeNodeHash required')
			break
		}
		case 'session_world_bind_channel': {
			if (!isChannelIdValid(content.channelId)) throw new Error('session_world_bind_channel: channelId required')
			if (!content.worldname?.trim()) throw new Error('session_world_bind_channel: worldname required')
			if (!content.ownerUsername?.trim()) throw new Error('session_world_bind_channel: ownerUsername required')
			if (!content.homeNodeHash?.trim()) throw new Error('session_world_bind_channel: homeNodeHash required')
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
