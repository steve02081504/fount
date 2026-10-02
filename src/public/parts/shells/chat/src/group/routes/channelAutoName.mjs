/**
 * 【文件】group/routes/channelAutoName.mjs
 * 【职责】DM 群空名频道自动命名/分类：新建频道后由 `scheduleDmChannelAutoName` 触发，
 *   对根级每个无名频道截取最近 13 条消息，交给本机默认 AI 源以 XML 标签命名并归入分类（分类缺失则自动创建）。
 * 【原理】仅在 DM 群（`groupKindFromState === 'dm'` 或带 friendBinding）执行；无默认 AI 源时
 *   跳过命名。异步总结用 `autoNamingInFlight` Map 去重（键 `groupId:channelId`），失败即从
 *   Map 移除，待下次新建频道时再触发；命名产出的 DAG 事件经群 WS 广播给前端。
 * 【关联】parts_loader.loadAnyPreferredDefaultPart、queries.readChannelMessagesForUser、
 *   dag/channelOperations、dag/append、decl/AIsource。
 */
import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { loadAnyPreferredDefaultPart } from '../../../../../../../server/parts_loader.mjs'
import { messageLineShowText } from '../../../public/shared/channelContent.mjs'
import { appendChannelLink, createChannel, removeChannelLink, updateChannel } from '../../chat/dag/channelOperations.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { groupKindFromState } from '../../chat/lib/notificationPreferences.mjs'
import { buildChannelContext, buildChannelPrompt, parseAutoNameResult } from '../lib/channelAutoNamePrompt.mjs'
import { withLock } from '../lib/locks.mjs'
import { readChannelMessagesForUser } from '../queries.mjs'

import { requireGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/** 每个空名频道最多读取的消息条数。 */
const CONTEXT_MESSAGE_COUNT = 13

/** 正在异步命名/分类的空名频道（键 `groupId:channelId`），防重复触发。 */
const autoNamingInFlight = new Map()

/** 每群分类 find-or-create 互斥锁：并发 autoName 共享，避免同群并发创建同名分类。 */
const categoryCreateLocks = new Map()

/**
 * 为单个空名频道异步命名/分类：读取最近消息 → AI StructCall → 必要时创建分类 → 更新频道并归入分类。
 * 失败由调用方捕获并放行（下次新建频道再触发）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 空名频道 id
 * @returns {Promise<boolean>} 是否成功命名
 */
async function autoNameChannelAsync(username, groupId, channelId) {
	const aiSource = await loadAnyPreferredDefaultPart(username, 'serviceSources/AI')
	if (!aiSource) return false
	const { state } = await getState(username, groupId)
	const channels = state.channels || {}
	const channel = channels[channelId]
	if (!channel || channel.type !== 'text' || String(channel?.name || '').trim()) return false

	/** 现有分类名（过滤空名分类并去重）。 */
	const categoryNames = [...new Set(
		Object.values(channels).filter(
			ch => ch?.type === 'category'
		).map(ch => String(ch.name || '').trim()).filter(Boolean),
	)]

	const lines = await readChannelMessagesForUser(username, groupId, channelId, { limit: CONTEXT_MESSAGE_COUNT })
	const texts = lines.flatMap(line => {
		const text = messageLineShowText(line, { onlyMessageTypes: true }).trim()
		return text ? [JSON.stringify({ speaker: line.content?.name || line.sender || '', text })] : []
	})
	if (!texts.length) return false
	const context = buildChannelContext(texts)

	const promptText = buildChannelPrompt(context, categoryNames)
	const promptStruct = {
		chat_log: [],
		char_prompt: { text: [] },
		user_prompt: {
			text: [{ content: promptText, description: '', important: 1 }],
			additional_chat_log: [],
			extension: {},
		},
		world_prompt: { text: [] },
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: {},
	}

	const result = await aiSource.StructCall(promptStruct)
	const { name, category } = parseAutoNameResult(String(result?.content || ''))
	if (!name) return false

	// AI 等待期间频道可能已被手动命名或删除：此时直接作废，不为它建分类。
	const { state: current } = await getState(username, groupId)
	const currentChannel = current.channels?.[channelId]
	if (!currentChannel || String(currentChannel.name || '').trim()) return false

	let categoryId = null
	if (category) {
		const categoryName = String(category).trim()
		// 锁内按「群 + 规范化分类名」原子查找或创建：每次都用最新状态查找，复用并发中已建的同名分类，
		// 避免重复建类，也不因预取快照中的过期 id 误挂到已删除分类上。
		categoryId = await withLock(categoryCreateLocks, groupId, async () => {
			const latest = await getState(username, groupId)
			const existing = Object.entries(latest.state.channels || {})
				.find(([, channel]) => channel?.type === 'category' && String(channel?.name || '').trim() === categoryName)
			if (existing) return existing[0]
			const rootChannelId = latest.state.groupSettings?.rootChannelId || null
			const created = await createChannel(username, groupId, {
				type: 'category',
				name: category,
				channelId: prefixedRandomId('channel_'),
				parentChannelId: rootChannelId,
			})
			return created.content?.channelId || null
		})
	}

	// 建分类也是异步写：重读最新状态，避免把名称/父链接写回已删除的频道。
	const { state: latest } = await getState(username, groupId)
	const targetChannel = latest.channels?.[channelId]
	if (!targetChannel) return false
	const categoryExists = !!categoryId && !!latest.channels?.[categoryId]

	// 单事件提交子频道侧更新（名称 + 权限块），父频道 links 另成一条，避免多次可部分成功的操作。
	const updates = {}
	if (targetChannel.name !== name) updates.name = name
	if (categoryExists) updates.permissionBlockId = categoryId
	if (Object.keys(updates).length)
		await updateChannel(username, groupId, channelId, updates)
	if (categoryExists) {
		// 移动而非复制：先从所有现有父频道的 links 移除该子频道，再挂到分类下，避免频道重复出现。
		for (const [parentChannelId, parent] of Object.entries(latest.channels)) {
			if (parentChannelId === categoryId) continue
			if (parent?.links?.includes(channelId))
				await removeChannelLink(username, groupId, parentChannelId, channelId)
		}
		await appendChannelLink(username, groupId, categoryId, channelId)
	}
	return true
}

/**
 * DM 群新建频道后异步命名/分类根级无名频道：
 *   截取每个无名频道最近 13 条消息，启动异步 AI 命名（Map 去重，失败放行）。
 *   频道现由用户手动创建，故不再自动清理只含问候语的“占位对话”（旧版进入聊天即新建对话的遗留）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} newChannelId 刚创建的新频道 id（跳过，避免用空上下文命名）
 * @param {object} state 物化群状态
 * @returns {Promise<void>}
 */
export async function scheduleDmChannelAutoName(username, groupId, newChannelId, state) {
	const isDm = groupKindFromState(state) === 'dm' || !!state.groupMeta?.friendBinding
	if (!isDm) return
	const rootChannelId = state.groupSettings?.rootChannelId
	if (!rootChannelId) return
	const candidates = (state.channels?.[rootChannelId]?.links || [])
		.filter(id => id !== newChannelId)
		.filter(id => {
			const channel = state.channels?.[id]
			return channel?.type === 'text' && !String(channel?.name || '').trim()
		})
	if (!candidates.length) return

	const toName = []
	for (const channelId of candidates) {
		const lines = await readChannelMessagesForUser(username, groupId, channelId, { limit: CONTEXT_MESSAGE_COUNT })
		if (!lines.length) continue
		toName.push(channelId)
	}

	for (const channelId of toName) {
		const key = `${groupId}:${channelId}`
		if (autoNamingInFlight.has(key)) continue
		autoNamingInFlight.set(key, true)
		void (async () => {
			try { await autoNameChannelAsync(username, groupId, channelId) }
			catch { /* 命名失败放行，待下次新建频道再触发 */ }
			finally { autoNamingInFlight.delete(key) }
		})()
	}
}

/**
 * 注册空名频道自动命名 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelAutoNameRoutes(router, authenticate) {
	router.post(`${GROUPS_PREFIX}/:groupId/channels/auto-name`, authenticate, requireGroupMember(), async (req, res) => {
		const {
			groupContext: { groupId, state, username },
		} = req

		if (!(groupKindFromState(state) === 'dm' || !!state.groupMeta?.friendBinding))
			throw httpError(403, 'auto-name is only allowed in DM groups')

		await scheduleDmChannelAutoName(username, groupId, '', state)
		res.status(200).json({ skipped: false, renamed: [] })
	})
}
