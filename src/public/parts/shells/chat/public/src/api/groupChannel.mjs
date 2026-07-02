/**
 * 【文件】public/src/api/groupChannel.mjs
 * 【职责】频道与消息 API：发消息、编辑/删除、时间线、投票、置顶、反馈、触发 AI 回复、频道 CRUD。
 * 【原理】content 经 channelContent.mjs 规范为对象；groupFetch POST/PUT 到 channels/:channelId/...；getChatTimeline 供 MessagePipeline 分页。
 * 【数据结构】textChannelContent、channelMessageContentObject；eventId、ballotId、timeline 游标。
 * 【关联】groupClient.mjs、lib/channelContent.mjs；MessagePipeline、Hub composer。
 */
import { channelMessageContentObject, textChannelContent } from '../lib/channelContent.mjs'

import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 对频道内投票单投一票。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} ballotId 投票单 ID
 * @param {string} choice 选项标识
 * @returns {Promise<object>} 产生的链上事件
 */
export async function castChannelVote(groupId, channelId, ballotId, choice) {
	const data = await groupFetch(
		groupPath(groupId, 'channels', channelId, 'votes', ballotId, 'cast'),
		{ method: 'POST', json: { choice } },
	)
	return data.event
}

/**
 * 置顶频道消息。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} targetEventId 目标消息事件 ID
 * @returns {Promise<void>}
 */
export async function pinMessage(groupId, channelId, targetEventId) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'pins'), {
		method: 'POST',
		json: { targetEventId },
	})
}

/**
 * 取消置顶频道消息。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} targetEventId 目标消息事件 ID
 * @returns {Promise<void>}
 */
export async function unpinMessage(groupId, channelId, targetEventId) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'pins', targetEventId), {
		method: 'DELETE',
	})
}

/**
 * 更新列表频道条目。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} items 列表项
 * @returns {Promise<void>}
 */
export async function updateChannelListItems(groupId, channelId, items) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'list-items'), {
		method: 'POST',
		json: { items },
	})
}

/**
 * 在频道内发起投票。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} body 投票单定义
 * @returns {Promise<{ event: object, ballotId: string }>} 事件与投票单 ID
 */
export async function createChannelVote(groupId, channelId, body) {
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'votes'), {
		method: 'POST',
		json: body,
	})
	return { event: data.event, ballotId: data.ballotId }
}

/**
 * 向频道发送消息。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string|object} content 纯文本或富内容对象
 * @param {object[]} [files] 附件（name、mime_type、buffer base64）
 * @returns {Promise<object>} 落盘后的 DAG `message` 事件
 */
export async function sendGroupMessage(groupId, channelId, content, files = []) {
	const body = {
		content: channelMessageContentObject(
			content?.type ? content : textChannelContent(content),
		),
	}
	if (files.length) body.files = files
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'messages'), {
		method: 'POST',
		json: body,
	})
	return data.event
}

/**
 * 向联邦邻居问询更早的频道消息并读回本地。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ before?: string, limit?: number }} [options] 游标与条数
 * @returns {Promise<object[]>} 合并写入本机后的消息行
 */
export async function requestChannelHistoryFromPeers(groupId, channelId, options = {}) {
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'history-want'), {
		method: 'POST',
		json: {
			before: options.before || null,
			limit: options.limit,
		},
	})
	return Array.isArray(data.messages) ? data.messages : []
}

/**
 * 分页拉取频道消息与反应事件。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ since?: string, before?: string, limit?: number, eventIds?: string[] }} [options] 游标与条数限制
 * @returns {Promise<{ messages: object[], reactions: Record<string, Record<string, { voters: string[] }>> }>} 消息与反应
 */
export async function getChannelMessages(groupId, channelId, options = {}) {
	if (Array.isArray(options.eventIds) && options.eventIds.length) {
		const data = await groupFetch(
			groupPath(groupId, 'channels', channelId, 'messages', 'batch-get'),
			{ method: 'POST', json: { eventIds: options.eventIds } },
		)
		return {
			messages: data.messages || [],
			reactions: data.reactions || {},
		}
	}
	const params = new URLSearchParams()
	if (options.since) params.append('since', options.since)
	if (options.before) params.append('before', options.before)
	if (options.limit) params.append('limit', String(options.limit))
	const query = params.toString()
	const data = await groupFetch(
		`${groupPath(groupId, 'channels', channelId, 'messages')}${query ? `?${query}` : ''}`,
		{ method: 'GET' },
	)
	return {
		messages: data.messages || [],
		reactions: data.reactions || {},
	}
}

/**
 * 拉取置顶消息 ±N 邻域（冷归档 + 热区）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} pinEventId 置顶 eventId
 * @returns {Promise<{ messages: object[] }>} 邻域消息
 */
export async function getPinContextMessages(groupId, channelId, pinEventId) {
	const data = await groupFetch(
		groupPath(groupId, 'channels', channelId, 'pin-context', pinEventId),
		{ method: 'GET' },
	)
	return { messages: data.messages || [] }
}

/**
 * 拉取进行中流的已缓冲分片（WS 晚加入时补流式显示）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} pendingStreamId DAG 占位 message eventId
 * @returns {Promise<{ chunkSeq: number, slices: object[] }[]>} 流式 diff 块列表
 */
export async function getStreamBufferChunks(groupId, channelId, pendingStreamId) {
	const data = await groupFetch(
		groupPath(groupId, 'channels', channelId, 'stream-buffer', pendingStreamId),
		{ method: 'GET' },
	)
	return data.chunks || []
}

/**
 * 读取群 chatLog 分支时间线游标（角色扮演分支导航，与频道 DAG 无关）。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ current: number, total: number }>} 当前索引与分支总数
 */
export async function getChatTimeline(groupId) {
	const data = await groupFetch(groupPath(groupId, 'timeline'), {
		method: 'GET',
	})
	return {
		current: Number(data.current) || 0,
		total: Number(data.total) || 1,
	}
}

/**
 * 调整频道时间线（前移/回退 DAG 叶）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {number} delta 时间线偏移步数
 * @returns {Promise<void>}
 */
export async function modifyChannelTimeline(groupId, channelId, delta) {
	await groupFetch(groupPath(groupId, 'timeline'), {
		method: 'PUT',
		json: { delta, channelId },
	})
}

/**
 * 触发频道内角色回复。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} [charname] 指定角色名；省略则由服务端选择
 * @returns {Promise<void>}
 */
export async function triggerChannelReply(groupId, channelId, charname) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'trigger-reply'), {
		method: 'POST',
		json: charname ? { charname } : {},
	})
}

/**
 * 编辑频道消息正文。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 消息事件 ID
 * @param {string|object} content 富内容对象（与 POST 对称）
 * @returns {Promise<void>}
 */
export async function editChannelMessage(groupId, channelId, eventId, content) {
	const bodyContent = channelMessageContentObject(
		typeof content === 'string' ? textChannelContent(content) : content,
	)
	await groupFetch(groupPath(groupId, 'channels', channelId, 'messages', eventId), {
		method: 'PUT',
		json: { content: bodyContent },
	})
}

/**
 * 删除频道消息。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 消息事件 ID
 * @returns {Promise<void>}
 */
export async function deleteChannelMessage(groupId, channelId, eventId) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'messages', eventId), {
		method: 'DELETE',
	})
}

/**
 * 设置消息反馈（点赞/点踩等）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 消息事件 ID
 * @param {string} type 反馈类型
 * @param {string} [reason] 可选说明
 * @returns {Promise<void>}
 */
export async function setChannelMessageFeedback(groupId, channelId, eventId, type, reason) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'messages', eventId, 'feedback'), {
		method: 'PUT',
		json: { type, content: reason || '' },
	})
}

/**
 * 在频道下创建子线程频道。
 * @param {string} groupId 群 ID
 * @param {string} channelId 父频道 ID
 * @param {string} parentEventId 父消息事件 ID
 * @returns {Promise<string>} 新子线程频道 ID
 */
export async function createChannelThread(groupId, channelId, parentEventId) {
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'threads'), {
		method: 'POST',
		json: { parentEventId },
	})
	return data.channelId
}

/**
 * 创建群频道。
 * @param {string} groupId 群 ID
 * @param {string} name 频道名称
 * @param {string} [type] 频道类型 text | list | streaming
 * @returns {Promise<string>} 新频道 ID
 */
export async function createChannel(groupId, name, type = 'text') {
	const data = await groupFetch(groupPath(groupId, 'channels'), {
		method: 'POST',
		json: { name, type },
	})
	return data.channelId
}

/**
 * 更新群频道元数据。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} updates name / description / type 等
 * @returns {Promise<void>}
 */
export async function updateChannel(groupId, channelId, updates) {
	await groupFetch(groupPath(groupId, 'channels', channelId), {
		method: 'PUT',
		json: updates,
	})
}

/**
 * 删除群频道。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function deleteChannel(groupId, channelId) {
	await groupFetch(groupPath(groupId, 'channels', channelId), {
		method: 'DELETE',
	})
}

/**
 * 将频道设为群默认频道。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function setDefaultChannel(groupId, channelId) {
	await groupFetch(groupPath(groupId, 'default-channel'), {
		method: 'PUT',
		json: { channelId },
	})
}
