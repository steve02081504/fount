/**
 * Moltbook 插件 ReplyHandler：解析回复中的 <moltbook_*> XML 标签，按角色解析 API 密钥并调用 API，将结果注入 AddLongTimeLog。
 */

import { loadData, saveData } from '../../../../server/setting_loader.mjs'

import { moltbookJson, moltbookRegister } from './api.mjs'

const PLUGIN_PARTPATH = 'plugins/moltbook'

/**
 * 从 parts_config 中按角色获取 Moltbook 密钥。
 * @param {string} username - 用户名。
 * @param {string} charId - 角色 ID。
 * @returns {{ api_key: string, agent_name?: string } | null} 该角色的密钥记录，未配置则 null。
 */
function getKeyForChar(username, charId) {
	const parts_config = loadData(username, 'parts_config')
	const pluginData = parts_config[PLUGIN_PARTPATH]
	const apikeys = pluginData?.apikeys ?? {}
	return apikeys[charId]
}

/**
 * 保存角色对应的密钥到 parts_config。
 * @param {string} username - 用户名。
 * @param {string} charId - 角色 ID。
 * @param {{ api_key: string, agent_name?: string, claim_url?: string, verification_code?: string }} record - 要保存的密钥记录。
 * @returns {void}
 */
function saveKeyForChar(username, charId, record) {
	const parts_config = loadData(username, 'parts_config')
	parts_config[PLUGIN_PARTPATH] ??= { apikeys: {} }
	parts_config[PLUGIN_PARTPATH].apikeys[charId] = {
		api_key: record.api_key,
		agent_name: record.agent_name,
		claim_url: record.claim_url,
		verification_code: record.verification_code,
	}
	saveData(username, 'parts_config')
}

/**
 * 解析 XML 属性字符串为对象。
 * @param {string} attrStr - 属性字符串（如 name="x" id="1"）。
 * @returns {Record<string, string>} 属性名到属性值的映射。
 */
function parseAttrs(attrStr) {
	const out = {}
	if (!attrStr?.trim()) return out
	for (const m of attrStr.matchAll(/(\w+)=["']([^"']*)["']/g))
		out[m[1]] = m[2]
	return out
}

/**
 * 从属性中取帖子/评论 ID。
 * @param {Record<string, string>} attrs - 标签属性对象。
 * @returns {string} id 或 post_id 的值。
 */
function getId(attrs) {
	return attrs.id ?? attrs.post_id ?? ''
}

/**
 * 从属性中取 submolt 名称。
 * @param {Record<string, string>} attrs - 标签属性对象。
 * @returns {string} submolt 或 name 的值。
 */
function getSubmolt(attrs) {
	return attrs.submolt ?? attrs.name ?? ''
}

/**
 * 将 API 结果格式化为可读文本。
 * @param {unknown} data - 任意 API 返回数据。
 * @returns {string} 格式化后的字符串。
 */
function formatResult(data) {
	if (!data) return ''
	if (Object(data) instanceof String) return data
	try {
		return JSON.stringify(data, null, '\t')
	}
	catch {
		return String(data)
	}
}

/**
 * 执行单个 moltbook 标签并返回要注入的日志内容；出错时返回错误信息。
 * @param {string} tag - 标签名（如 register, bind_key, me, post, feed, ...）
 * @param {Record<string, string>} attrs - 属性
 * @param {string} [body] - 标签体（如有）
 * @param {{ username: string, char_id: string }} ctx - 当前用户与角色上下文。
 * @returns {Promise<string | null>} 要加入 AddLongTimeLog 的 content；null 表示无需注入（如未命中）。
 */
async function runTag(tag, attrs, body, ctx) {
	const { username, char_id } = ctx

	if (tag === 'register') {
		const name = attrs.name?.trim()
		const description = (body ?? '').trim()
		if (!name)
			return '注册需要 name 属性与标签体简介，例如 <moltbook_register name="MyAgent">简介</moltbook_register>'

		const res = await moltbookRegister({ name, description })
		if (res.agent?.api_key) {
			saveKeyForChar(username, char_id, {
				api_key: res.agent.api_key,
				agent_name: name,
				claim_url: res.agent.claim_url,
				verification_code: res.agent.verification_code,
			})
			return `注册成功。请让人类完成认领：\nclaim_url: ${res.agent.claim_url}\nverification_code: ${res.agent.verification_code}\napi_key是\`${res.agent.api_key}\`，已保存到本插件，可直接使用其他 Moltbook 标签而无需传回。`
		}
		return `注册失败: ${res.error ?? 'unknown'}`
	}

	if (tag === 'bind_key') {
		const api_key = (body ?? '').trim()
		if (!api_key)
			return '绑定密钥需在标签体内写 api_key，例如 <moltbook_bind_key>moltbook_xxx</moltbook_bind_key>'

		const res = await moltbookJson(api_key, 'agents/me')
		if (res.error)
			return `密钥验证失败: ${res.error}${res.hint ? '\n' + res.hint : ''}`

		const agentName = res.agent?.name ?? res.name ?? ''
		saveKeyForChar(username, char_id, { api_key, agent_name: agentName })
		return `已绑定密钥，对应账号: ${agentName || '(未获取到名称)'}。可无缝从 curl 切换到本插件使用。`
	}

	const keyRecord = getKeyForChar(username, char_id)
	if (!keyRecord?.api_key)
		return '未找到本角色的 Moltbook 密钥。请先使用 <moltbook_register name="代理名">简介</moltbook_register> 注册，或 <moltbook_bind_key>密钥</moltbook_bind_key> 绑定已有密钥。'

	const apiKey = keyRecord.api_key

	const id = getId(attrs)
	/**
	 * 去除标签体首尾空白。
	 * @param {string} [b] - 标签体内容。
	 * @returns {string} 修剪后的字符串。
	 */
	const trimBody = (b) => (b ?? '').trim()

	switch (tag) {
		case 'status':
			return formatResult(await moltbookJson(apiKey, 'agents/status'))
		case 'me':
			return formatResult(await moltbookJson(apiKey, 'agents/me'))
		case 'profile': {
			const name = attrs.name?.trim()
			if (!name) return 'profile 需要 name 属性。'
			return formatResult(await moltbookJson(apiKey, `agents/profile?name=${encodeURIComponent(name)}`))
		}
		case 'update_profile': {
			const description = trimBody(body)
			return formatResult(await moltbookJson(apiKey, 'agents/me', {
				method: 'PATCH',
				body: { description, metadata: attrs.metadata ? JSON.parse(attrs.metadata) : undefined },
			}))
		}
		case 'post': {
			const submolt = attrs.submolt ?? 'general'
			const title = attrs.title ?? ''
			const content = trimBody(body)
			const url = attrs.url ?? ''
			if (!url && !content) return '发帖：链接帖用 <moltbook_post submolt="..." title="..." url="链接" />，正文帖用 <moltbook_post submolt="..." title="...">正文</moltbook_post>'
			return formatResult(await moltbookJson(apiKey, 'posts', {
				method: 'POST',
				body: url ? { submolt, title, url } : { submolt, title, content },
			}))
		}
		case 'feed': {
			const sort = attrs.sort ?? 'hot'
			const limit = attrs.limit ?? '25'
			return formatResult(await moltbookJson(apiKey, `posts?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(limit)}`))
		}
		case 'submolt_feed': {
			const submolt = attrs.submolt ?? 'general'
			const sort = attrs.sort ?? 'new'
			return formatResult(await moltbookJson(apiKey, `submolts/${encodeURIComponent(submolt)}/feed?sort=${encodeURIComponent(sort)}`))
		}
		case 'get_post':
			if (!id) return 'get_post 需要 id 或 post_id。'
			return formatResult(await moltbookJson(apiKey, `posts/${encodeURIComponent(id)}`))
		case 'delete_post':
			if (!id) return 'delete_post 需要 id 或 post_id。'
			return formatResult(await moltbookJson(apiKey, `posts/${encodeURIComponent(id)}`, { method: 'DELETE' }))
		case 'comment': {
			const content = trimBody(body)
			const parent_id = attrs.parent_id ?? ''
			if (!id || !content) return 'comment 需要 post_id 属性与标签体评论内容，例如 <moltbook_comment post_id="POST_ID">评论</moltbook_comment>'
			return formatResult(await moltbookJson(apiKey, `posts/${encodeURIComponent(id)}/comments`, {
				method: 'POST',
				body: parent_id ? { content, parent_id } : { content },
			}))
		}
		case 'comments': {
			if (!id) return 'comments 需要 post_id 或 id。'
			const sort = attrs.sort ?? 'top'
			return formatResult(await moltbookJson(apiKey, `posts/${encodeURIComponent(id)}/comments?sort=${encodeURIComponent(sort)}`))
		}
		case 'vote_post': {
			if (!id) return 'vote_post 需要 id 或 post_id，以及 direction="up" 或 direction="down"。'
			const direction = (attrs.direction ?? 'up').toLowerCase()
			const path = direction === 'down' ? 'downvote' : 'upvote'
			return formatResult(await moltbookJson(apiKey, `posts/${encodeURIComponent(id)}/${path}`, { method: 'POST' }))
		}
		case 'vote_comment': {
			const commentId = attrs.id ?? attrs.comment_id ?? ''
			if (!commentId) return 'vote_comment 需要 id 或 comment_id，direction 为 up。'
			if ((attrs.direction ?? 'up').toLowerCase() !== 'up') return '评论仅支持 direction="up"。'
			return formatResult(await moltbookJson(apiKey, `comments/${encodeURIComponent(commentId)}/upvote`, { method: 'POST' }))
		}
		case 'submolts':
			return formatResult(await moltbookJson(apiKey, 'submolts'))
		case 'submolt': {
			const name = attrs.name ?? ''
			if (!name) return 'submolt 需要 name。'
			return formatResult(await moltbookJson(apiKey, `submolts/${encodeURIComponent(name)}`))
		}
		case 'create_submolt': {
			const name = attrs.name ?? ''
			const display_name = attrs.display_name ?? name
			const description = trimBody(body)
			if (!name) return 'create_submolt 需要 name 属性与标签体描述，例如 <moltbook_create_submolt name="xxx" display_name="显示名">描述</moltbook_create_submolt>'
			return formatResult(await moltbookJson(apiKey, 'submolts', {
				method: 'POST',
				body: { name, display_name, description },
			}))
		}
		case 'subscribe': {
			const submolt = getSubmolt(attrs)
			if (!submolt) return 'subscribe 需要 submolt。'
			return formatResult(await moltbookJson(apiKey, `submolts/${encodeURIComponent(submolt)}/subscribe`, { method: 'POST' }))
		}
		case 'unsubscribe': {
			const submolt = getSubmolt(attrs)
			if (!submolt) return 'unsubscribe 需要 submolt。'
			return formatResult(await moltbookJson(apiKey, `submolts/${encodeURIComponent(submolt)}/subscribe`, { method: 'DELETE' }))
		}
		case 'follow': {
			const name = attrs.name ?? ''
			if (!name) return 'follow 需要 name。'
			return formatResult(await moltbookJson(apiKey, `agents/${encodeURIComponent(name)}/follow`, { method: 'POST' }))
		}
		case 'unfollow': {
			const name = attrs.name ?? ''
			if (!name) return 'unfollow 需要 name。'
			return formatResult(await moltbookJson(apiKey, `agents/${encodeURIComponent(name)}/follow`, { method: 'DELETE' }))
		}
		case 'personal_feed': {
			const sort = attrs.sort ?? 'hot'
			const limit = attrs.limit ?? '25'
			return formatResult(await moltbookJson(apiKey, `feed?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(limit)}`))
		}
		case 'search': {
			const q = trimBody(body)
			if (!q) return 'search 需在标签体内写查询，例如 <moltbook_search>自然语言查询</moltbook_search>'
			const type = attrs.type ?? 'all'
			const limit = attrs.limit ?? '20'
			return formatResult(await moltbookJson(apiKey, `search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&limit=${encodeURIComponent(limit)}`))
		}
		case 'pin_post':
			if (!id) return 'pin_post 需要 id 或 post_id。'
			return formatResult(await moltbookJson(apiKey, `posts/${encodeURIComponent(id)}/pin`, { method: 'POST' }))
		case 'unpin_post':
			if (!id) return 'unpin_post 需要 id 或 post_id。'
			return formatResult(await moltbookJson(apiKey, `posts/${encodeURIComponent(id)}/pin`, { method: 'DELETE' }))
		default:
			return null
	}
}

/** 匹配 <moltbook_xxx ... /> 或 <moltbook_xxx ...>...</moltbook_xxx> */
const MOLTBOOK_TAG_REGEX = /<moltbook_(\w+)(\s*[^>]*?)(?:\/>|>([\S\s]*?)<\/moltbook_\1>)/gi

/**
 * Moltbook ReplyHandler：解析 result.content 中所有 <moltbook_*> 标签，执行并 AddLongTimeLog，返回 true 触发重新生成。
 * @type {import('../../../../decl/PluginAPI.ts').ReplyHandler_t}
 * @returns {Promise<boolean>} 若处理了标签并需重新生成则为 true，否则 false。
 */
export async function moltbookReplyHandler(reply, args) {
	const content = reply?.content ?? ''
	const matches = [...content.matchAll(MOLTBOOK_TAG_REGEX)]
	if (matches.length === 0) return false

	const ctx = {
		username: args.username,
		char_id: args.char_id
	}
	const addLog = args.AddLongTimeLog
	if (!addLog) return false

	for (const m of matches) {
		const tag = m[1].toLowerCase()
		const attrStr = m[2] ?? ''
		const body = m[3]?.trim()
		const attrs = parseAttrs(attrStr)
		try {
			const content = await runTag(tag, attrs, body, ctx)
			if (content)
				addLog({
					name: 'moltbook',
					role: 'tool',
					content,
					files: [],
				})
		} catch (err) {
			addLog({
				name: 'moltbook',
				role: 'tool',
				content: `执行 <moltbook_${tag}> 出错: ${err?.message ?? err}`,
				files: [],
			})
		}
	}
	return true
}
