/**
 * 【文件】group/routes/channelAutoName.mjs
 * 【职责】DM 群空名频道自动命名/分类：对每个空名频道逐一读取最近消息并交给本机默认 AI 源，
 *   要求以 XML 标签输出频道名与分类名，随后重命名并移动到分类（分类缺失则自动创建）。
 * 【原理】仅在 DM 群（`groupKindFromState === 'dm'` 或带 friendBinding）执行；无默认 AI 源时
 *   `{ skipped: true }`。每个空名频道独立调用一次 `StructCall`，输出格式参照内置插件用
 *   `<标签>…</标签>` 包裹结构化字段（`<channel-name>` / `<category-name>`）。
 * 【关联】parts_loader.loadAnyPreferredDefaultPart、queries.readChannelMessagesForUser、
 *   dag/channelOperations、decl/AIsource。
 */
import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { loadAnyPreferredDefaultPart } from '../../../../../../../server/parts_loader.mjs'
import { messageLineShowText } from '../../../public/shared/channelContent.mjs'
import {
	appendChannelLink,
	createChannel,
	updateChannel,
} from '../../chat/dag/channelOperations.mjs'
import { groupKindFromState } from '../../chat/lib/notificationPreferences.mjs'
import { readChannelMessagesForUser } from '../queries.mjs'

import { requireGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/** 每个空名频道最多读取的消息条数 */
const CONTEXT_MESSAGE_COUNT = 20
/** 每个空名频道送入 AI 的上下文最大字符数 */
const CONTEXT_MAX_CHARS = 4000

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

		const isDm = groupKindFromState(state) === 'dm' || !!state.groupMeta?.friendBinding
		if (!isDm)
			throw httpError(403, 'auto-name is only allowed in DM groups')

		const aiSource = await loadAnyPreferredDefaultPart(username, 'serviceSources/AI')
		if (!aiSource) {
			res.status(200).json({ skipped: true, renamed: [] })
			return
		}

		const channels = state.channels || {}
		const emptyChannels = Object.entries(channels)
			.filter(([, ch]) => ch?.type === 'text' && !String(ch?.name || '').trim())
			.map(([id]) => id)
		if (!emptyChannels.length) {
			res.status(200).json({ skipped: false, renamed: [] })
			return
		}

		/** @type {Map<string, string>} 分类名 → 频道 id（含本次新建，供复用） */
		const categoryIdByName = new Map(
			Object.entries(channels)
				.filter(([, ch]) => ch?.type === 'category' && String(ch?.name || '').trim())
				.map(([id, ch]) => [String(ch.name).trim(), id]),
		)
		/** 现有分类名（与 categoryIdByName 键同步）。 */
		const categoryNames = [...categoryIdByName.keys()]

		/** @type {string[]} */
		const renamed = []
		for (const channelId of emptyChannels) {
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
			if (!name) continue

			let categoryId = null
			if (category) {
				categoryId = categoryIdByName.get(category)
				if (!categoryId) {
					const created = await createChannel(username, groupId, {
						type: 'category',
						name: category,
						channelId: prefixedRandomId('channel_'),
					})
					categoryId = created.content?.channelId || null
					if (categoryId) {
						categoryIdByName.set(category, categoryId)
						categoryNames.push(category)
					}
				}
			}

			// 单事件提交子频道侧更新（名称 + 权限块），父频道 links 另成一条，避免多次可部分成功的操作。
			const updates = {}
			if (channels[channelId]?.name !== name) updates.name = name
			if (categoryId) updates.permissionBlockId = categoryId
			if (Object.keys(updates).length)
				await updateChannel(username, groupId, channelId, updates)
			if (categoryId)
				await appendChannelLink(username, groupId, categoryId, channelId)
			renamed.push(channelId)
		}

		res.status(200).json({ skipped: false, renamed })
	})
}
