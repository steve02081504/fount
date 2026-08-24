/**
 * 【文件】group/routes/channelAutoName.mjs
 * 【职责】DM 群空名频道自动命名/分类与 greeting-only 占位频道清理：新建频道后由
 *   `scheduleDmChannelAutoNameAndCleanup` 触发，对根级每个无名频道截取最近 13 条消息：
 *   全部为问候语则删除，否则交给本机默认 AI 源以 XML 标签命名并归入分类（分类缺失则自动创建）。
 * 【原理】仅在 DM 群（`groupKindFromState === 'dm'` 或带 friendBinding）执行；无默认 AI 源时
 *   跳过命名。异步总结用 `autoNamingInFlight` Map 去重（键 `groupId:channelId`），失败即从
 *   Map 移除，待下次新建频道时再触发；清理/命名产出的 DAG 事件经群 WS 广播给前端。
 * 【关联】parts_loader.loadAnyPreferredDefaultPart、queries.readChannelMessagesForUser、
 *   dag/channelOperations、dag/append、decl/AIsource。
 */
import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { loadAnyPreferredDefaultPart } from '../../../../../../../server/parts_loader.mjs'
import { messageLineShowText } from '../../../public/shared/channelContent.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import {
	appendChannelLink,
	createChannel,
	deleteChannel,
	updateChannel,
} from '../../chat/dag/channelOperations.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { groupKindFromState } from '../../chat/lib/notificationPreferences.mjs'
import { readChannelMessagesForUser } from '../queries.mjs'

import { requireGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/** 每个空名频道最多读取的消息条数（判断 greeting-only 也复用此阈值：取最近 13 条）。 */
const CONTEXT_MESSAGE_COUNT = 13
/** 每个空名频道送入 AI 的上下文最大字符数 */
const CONTEXT_MAX_CHARS = 4000

/** 正在异步命名/分类的空名频道（键 `groupId:channelId`），防重复触发。 */
const autoNamingInFlight = new Map()

/**
 * 判断一条频道消息是否为问候语（world greeting / 角色开场）。
 * @param {object} message 频道消息行
 * @returns {boolean} 是问候语为 true
 */
function isGreetingOnlyMessage(message) {
	return !!(message?.content?.extension?.chat?.isGreeting
		|| message?.content?.extension?.timeSlice?.greeting_type)
}

/**
 * 将频道最近消息聚合成一个上下文块：合并为一条文本（超长时截断并标注省略）。
 * @param {string[]} texts 消息正文数组（旧→新）
 * @returns {string} 合并后的上下文文本
 */
function buildChannelContext(texts) {
	const joined = texts.map(text => `…${text}…`).join('\n')
	if (joined.length <= CONTEXT_MAX_CHARS) return joined
	return `${joined.slice(0, CONTEXT_MAX_CHARS)}\n[…以下内容过长已省略…]`
}

/**
 * 从 AI 回复正文中提取 `<channel-name>` / `<category-name>` 标签内容。
 * @param {string} content AI 回复正文
 * @returns {{ name?: string, category?: string }} 提取到的名称
 */
function parseAutoNameResult(content) {
	const name = content.match(/<channel-name>([\S\s]*?)<\/channel-name>/i)?.[1]?.trim()
	const category = content.match(/<category-name>([\S\s]*?)<\/category-name>/i)?.[1]?.trim()
	return { name, category }
}

/**
 * 为单个空名频道构造命名请求 prompt（XML 输出格式，参照内置插件标签式结构）。
 * @param {string} context 频道上下文
 * @param {string[]} categoryNames 现有分类名
 * @returns {string} prompt 文本
 */
function buildChannelPrompt(context, categoryNames) {
	return [
		'你是频道整理助手。下面是一个未命名频道的内容摘要，以及该群现有的频道分类列表。',
		'请为该频道生成一个简短的频道名（<=20字）和合适的分类名。',
		'分类名尽量复用下面现有的分类；若确实没有合适的现有分类，可以提出一个新的分类名（会自动创建）。',
		`现有分类：${categoryNames.length ? categoryNames.join('、') : '（无）'}`,
		'',
		'## 未命名频道内容',
		context,
		'',
		'请严格使用如下 XML 标签输出，不要输出多余内容：',
		'<channel-name>新的频道名</channel-name>',
		'<category-name>分类名</category-name>',
	].join('\n')
}

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
	if (!channel || channel.type !== 'text' || String(channel.name || '').trim()) return false

	/** @type {Map<string, string>} 分类名 → 频道 id（含本次新建，供复用） */
	const categoryIdByName = new Map(
		Object.entries(channels)
			.filter(([, ch]) => ch?.type === 'category' && String(ch?.name || '').trim())
			.map(([id, ch]) => [String(ch.name).trim(), id]),
	)
	/** 现有分类名（与 categoryIdByName 键同步）。 */
	const categoryNames = [...categoryIdByName.keys()]

	const lines = await readChannelMessagesForUser(username, groupId, channelId, { limit: CONTEXT_MESSAGE_COUNT })
	const texts = lines.map(line => messageLineShowText(line, { onlyMessageTypes: true })).filter(Boolean)
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

	let categoryId = null
	if (category) {
		categoryId = categoryIdByName.get(category)
		if (!categoryId) {
			const rootChannelId = state.groupSettings?.rootChannelId || null
			const created = await createChannel(username, groupId, {
				type: 'category',
				name: category,
				channelId: prefixedRandomId('channel_'),
				parentChannelId: rootChannelId,
			})
			categoryId = created.content?.channelId || null
		}
	}

	// 单事件提交子频道侧更新（名称 + 权限块），父频道 links 另成一条，避免多次可部分成功的操作。
	const updates = {}
	if (channel.name !== name) updates.name = name
	if (categoryId) updates.permissionBlockId = categoryId
	if (Object.keys(updates).length)
		await updateChannel(username, groupId, channelId, updates)
	if (categoryId)
		await appendChannelLink(username, groupId, categoryId, channelId)
	return true
}

/**
 * DM 群新建频道后异步清理/命名根级无名频道：
 *   截取每个无名频道最近 13 条消息，全为问候语则删除，否则启动异步 AI 命名（Map 去重，失败放行）。
 *   若被删除频道是默认频道，先改默认频道为刚创建的新频道。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} newChannelId 刚创建的新频道 id
 * @param {object} state 物化群状态
 * @returns {Promise<void>}
 */
export async function scheduleDmChannelAutoNameAndCleanup(username, groupId, newChannelId, state) {
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

	const toDelete = []
	const toName = []
	for (const channelId of candidates) {
		const lines = await readChannelMessagesForUser(username, groupId, channelId, { limit: CONTEXT_MESSAGE_COUNT })
		if (!lines.length) continue
		if (lines.every(isGreetingOnlyMessage)) toDelete.push(channelId)
		else toName.push(channelId)
	}

	const defaultChannelId = state.groupSettings?.defaultChannelId
	if (toDelete.includes(defaultChannelId))
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { defaultChannelId: newChannelId },
		})

	for (const channelId of toDelete)
		await deleteChannel(username, groupId, channelId).catch(() => {})

	for (const channelId of toName) {
		const key = `${groupId}:${channelId}`
		if (autoNamingInFlight.has(key)) continue
		autoNamingInFlight.set(key, true)
		autoNameChannelAsync(username, groupId, channelId)
			.catch(() => {})
			.finally(() => autoNamingInFlight.delete(key))
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

		await scheduleDmChannelAutoNameAndCleanup(username, groupId, '', state)
		res.status(200).json({ skipped: false, renamed: [] })
	})
}
