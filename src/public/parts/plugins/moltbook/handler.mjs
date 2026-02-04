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
 * @returns {object | undefined} 该角色的密钥记录，未配置则为 undefined。
 */
function getKeyForChar(username, charId) {
	const parts_config = loadData(username, 'parts_config')
	const apikeys = parts_config[PLUGIN_PARTPATH]?.apikeys ?? {}
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
 * @param {string} [attributeString] - 属性字符串（如 name="x" id="1"）。
 * @returns {Record<string, string>} 属性名到属性值的映射。
 */
function parseAttributes(attributeString) {
	const out = {}
	if (!attributeString?.trim()) return out
	for (const match of attributeString.matchAll(/(\w+)=["']([^"']*)["']/g))
		out[match[1]] = match[2]
	return out
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
 * 去除标签体首尾空白。
 * @param {string} [tagBody] - 标签体内容。
 * @returns {string} 修剪后的字符串。
 */
const trimTagBody = (tagBody) => (tagBody ?? '').trim()

/**
 * 从属性中取帖子/评论 ID。
 * @param {Record<string, string>} attributes - 标签属性对象。
 * @returns {string} id 或 post_id 的值。
 */
const getPostId = (attributes) => attributes.id ?? attributes.post_id ?? ''

/**
 * 从属性中取 submolt 名称。
 * @param {Record<string, string>} attributes - 标签属性对象。
 * @returns {string} submolt 或 name 的值。
 */
const getSubmoltName = (attributes) => attributes.submolt ?? attributes.name ?? ''

/** 未配置密钥时的提示文案。 */
const NO_KEY_MESSAGE = '未找到本角色的 Moltbook 密钥。请先使用 <moltbook_register name="代理名">简介</moltbook_register> 注册，或 <moltbook_bind_key>密钥</moltbook_bind_key> 绑定已有密钥。'

/**
 * 单次标签执行请求。ensureApiKey 成功后会附加 apiKey。
 * @typedef {{
 *   tag: string,
 *   attributes: Record<string, string>,
 *   tagBody: string,
 *   username: string,
 *   char_id: string,
 *   [apiKey]?: string
 * }} TagRequest
 */

/**
 * 为需要 API 的标签在 request 上附加 apiKey；若无则返回错误文案，否则返回 null。
 * @param {TagRequest} request - 单次标签请求，成功时会附加 apiKey。
 * @returns {string | null} 若无法取得密钥则返回错误文案，否则返回 null。
 */
function ensureApiKey(request) {
	const keyRecord = getKeyForChar(request.username, request.char_id)
	if (!keyRecord?.api_key) return NO_KEY_MESSAGE
	request.apiKey = keyRecord.api_key
	return null
}

/**
 * 各 moltbook 标签的处理函数，仅包含需要 API 的标签；register / bind_key 在 runTag 内单独处理。
 * @type {Record<string, (request: TagRequest) => Promise<string | null>>}
 */
const HANDLERS = {
	/**
	 * 查询代理状态。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	status: (request) => moltbookJson(request.apiKey, 'agents/status').then(formatResult),

	/**
	 * 查询当前代理信息。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	me: (request) => moltbookJson(request.apiKey, 'agents/me').then(formatResult),

	/**
	 * 查询指定名称的代理资料。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	profile: (request) => {
		const name = request.attributes.name?.trim()
		if (!name) return Promise.resolve('profile 需要 name 属性。')
		return moltbookJson(request.apiKey, `agents/profile?name=${encodeURIComponent(name)}`).then(formatResult)
	},

	/**
	 * 更新当前代理资料。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	update_profile: (request) =>
		moltbookJson(request.apiKey, 'agents/me', {
			method: 'PATCH',
			body: {
				description: trimTagBody(request.tagBody),
				metadata: request.attributes.metadata ? JSON.parse(request.attributes.metadata) : undefined,
			},
		}).then(formatResult),

	/**
	 * 发帖。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	post: (request) => {
		const submolt = request.attributes.submolt ?? 'general'
		const title = request.attributes.title ?? ''
		const content = trimTagBody(request.tagBody)
		const url = request.attributes.url ?? ''
		if (!url && !content)
			return Promise.resolve('发帖：链接帖用 <moltbook_post submolt="..." title="..." url="链接" />，正文帖用 <moltbook_post submolt="..." title="...">正文</moltbook_post>')
		const body = url ? { submolt, title, url } : { submolt, title, content }
		return moltbookJson(request.apiKey, 'posts', { method: 'POST', body }).then(formatResult)
	},

	/**
	 * 获取帖子流。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	feed: (request) => {
		const sort = request.attributes.sort ?? 'hot'
		const limit = request.attributes.limit ?? '25'
		return moltbookJson(request.apiKey, `posts?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(limit)}`).then(formatResult)
	},

	/**
	 * 获取指定 submolt 的帖子流。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	submolt_feed: (request) => {
		const submolt = request.attributes.submolt ?? 'general'
		const sort = request.attributes.sort ?? 'new'
		return moltbookJson(request.apiKey, `submolts/${encodeURIComponent(submolt)}/feed?sort=${encodeURIComponent(sort)}`).then(formatResult)
	},

	/**
	 * 获取单篇帖子。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	get_post: (request) => {
		const id = getPostId(request.attributes)
		if (!id) return Promise.resolve('get_post 需要 id 或 post_id。')
		return moltbookJson(request.apiKey, `posts/${encodeURIComponent(id)}`).then(formatResult)
	},

	/**
	 * 删除帖子。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	delete_post: (request) => {
		const id = getPostId(request.attributes)
		if (!id) return Promise.resolve('delete_post 需要 id 或 post_id。')
		return moltbookJson(request.apiKey, `posts/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(formatResult)
	},

	/**
	 * 发表评论。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	comment: (request) => {
		const id = getPostId(request.attributes)
		const content = trimTagBody(request.tagBody)
		const parent_id = request.attributes.parent_id ?? ''
		if (!id || !content)
			return Promise.resolve('comment 需要 post_id 属性与标签体评论内容，例如 <moltbook_comment post_id="POST_ID">评论</moltbook_comment>')
		const body = parent_id ? { content, parent_id } : { content }
		return moltbookJson(request.apiKey, `posts/${encodeURIComponent(id)}/comments`, { method: 'POST', body }).then(formatResult)
	},

	/**
	 * 获取帖子评论列表。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	comments: (request) => {
		const id = getPostId(request.attributes)
		if (!id) return Promise.resolve('comments 需要 post_id 或 id。')
		const sort = request.attributes.sort ?? 'top'
		return moltbookJson(request.apiKey, `posts/${encodeURIComponent(id)}/comments?sort=${encodeURIComponent(sort)}`).then(formatResult)
	},

	/**
	 * 对帖子投票。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	vote_post: (request) => {
		const id = getPostId(request.attributes)
		if (!id) return Promise.resolve('vote_post 需要 id 或 post_id，以及 direction="up" 或 direction="down"。')
		const direction = (request.attributes.direction ?? 'up').toLowerCase()
		const path = direction === 'down' ? 'downvote' : 'upvote'
		return moltbookJson(request.apiKey, `posts/${encodeURIComponent(id)}/${path}`, { method: 'POST' }).then(formatResult)
	},

	/**
	 * 对评论投票。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	vote_comment: (request) => {
		const commentId = request.attributes.id ?? request.attributes.comment_id ?? ''
		if (!commentId) return Promise.resolve('vote_comment 需要 id 或 comment_id，direction 为 up。')
		if ((request.attributes.direction ?? 'up').toLowerCase() !== 'up') return Promise.resolve('评论仅支持 direction="up"。')
		return moltbookJson(request.apiKey, `comments/${encodeURIComponent(commentId)}/upvote`, { method: 'POST' }).then(formatResult)
	},

	/**
	 * 获取 submolts 列表。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	submolts: (request) => moltbookJson(request.apiKey, 'submolts').then(formatResult),

	/**
	 * 获取指定 submolt 信息。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	submolt: (request) => {
		const name = request.attributes.name ?? ''
		if (!name) return Promise.resolve('submolt 需要 name。')
		return moltbookJson(request.apiKey, `submolts/${encodeURIComponent(name)}`).then(formatResult)
	},

	/**
	 * 创建 submolt。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	create_submolt: (request) => {
		const name = request.attributes.name ?? ''
		const display_name = request.attributes.display_name ?? name
		const description = trimTagBody(request.tagBody)
		if (!name)
			return Promise.resolve('create_submolt 需要 name 属性与标签体描述，例如 <moltbook_create_submolt name="xxx" display_name="显示名">描述</moltbook_create_submolt>')
		return moltbookJson(request.apiKey, 'submolts', {
			method: 'POST',
			body: { name, display_name, description },
		}).then(formatResult)
	},

	/**
	 * 订阅 submolt。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	subscribe: (request) => {
		const submolt = getSubmoltName(request.attributes)
		if (!submolt) return Promise.resolve('subscribe 需要 submolt。')
		return moltbookJson(request.apiKey, `submolts/${encodeURIComponent(submolt)}/subscribe`, { method: 'POST' }).then(formatResult)
	},

	/**
	 * 取消订阅 submolt。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	unsubscribe: (request) => {
		const submolt = getSubmoltName(request.attributes)
		if (!submolt) return Promise.resolve('unsubscribe 需要 submolt。')
		return moltbookJson(request.apiKey, `submolts/${encodeURIComponent(submolt)}/subscribe`, { method: 'DELETE' }).then(formatResult)
	},

	/**
	 * 关注指定代理。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	follow: (request) => {
		const name = request.attributes.name ?? ''
		if (!name) return Promise.resolve('follow 需要 name。')
		return moltbookJson(request.apiKey, `agents/${encodeURIComponent(name)}/follow`, { method: 'POST' }).then(formatResult)
	},

	/**
	 * 取消关注指定代理。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	unfollow: (request) => {
		const name = request.attributes.name ?? ''
		if (!name) return Promise.resolve('unfollow 需要 name。')
		return moltbookJson(request.apiKey, `agents/${encodeURIComponent(name)}/follow`, { method: 'DELETE' }).then(formatResult)
	},

	/**
	 * 获取个人时间线。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	personal_feed: (request) => {
		const sort = request.attributes.sort ?? 'hot'
		const limit = request.attributes.limit ?? '25'
		return moltbookJson(request.apiKey, `feed?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(limit)}`).then(formatResult)
	},

	/**
	 * 搜索。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	search: (request) => {
		const query = trimTagBody(request.tagBody)
		if (!query) return Promise.resolve('search 需在标签体内写查询，例如 <moltbook_search>自然语言查询</moltbook_search>')
		const type = request.attributes.type ?? 'all'
		const limit = request.attributes.limit ?? '20'
		return moltbookJson(request.apiKey, `search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&limit=${encodeURIComponent(limit)}`).then(formatResult)
	},

	/**
	 * 置顶帖子。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	pin_post: (request) => {
		const id = getPostId(request.attributes)
		if (!id) return Promise.resolve('pin_post 需要 id 或 post_id。')
		return moltbookJson(request.apiKey, `posts/${encodeURIComponent(id)}/pin`, { method: 'POST' }).then(formatResult)
	},

	/**
	 * 取消置顶帖子。
	 * @param {TagRequest} request - 单次标签请求。
	 * @returns {Promise<string | null>} 要写入日志的内容或 null。
	 */
	unpin_post: (request) => {
		const id = getPostId(request.attributes)
		if (!id) return Promise.resolve('unpin_post 需要 id 或 post_id。')
		return moltbookJson(request.apiKey, `posts/${encodeURIComponent(id)}/pin`, { method: 'DELETE' }).then(formatResult)
	},
}

/**
 * 执行单个 moltbook 标签并返回要注入的日志内容；未命中或无需注入时返回 null。
 * @param {TagRequest} request - 单次标签请求（tag、attributes、tagBody、username、char_id）。
 * @returns {Promise<string | null>} 要写入 AddLongTimeLog 的内容，或 null 表示无需注入。
 */
async function runTag(request) {
	const { tag, attributes, tagBody, username, char_id } = request

	// 无需 API 的标签
	if (tag === 'register') {
		const name = attributes.name?.trim()
		const description = trimTagBody(tagBody)
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
		const api_key = trimTagBody(tagBody)
		if (!api_key)
			return '绑定密钥需在标签体内写 api_key，例如 <moltbook_bind_key>moltbook_xxx</moltbook_bind_key>'

		const res = await moltbookJson(api_key, 'agents/me')
		if (res.error)
			return `密钥验证失败: ${res.error}${res.hint ? '\n' + res.hint : ''}`

		const agentName = res.agent?.name ?? res.name ?? ''
		saveKeyForChar(username, char_id, { api_key, agent_name: agentName })
		return `已绑定密钥，对应账号: ${agentName || '(未获取到名称)'}。可无缝从 curl 切换到本插件使用。`
	}

	// 需要 API 的标签：确保密钥并派发到 HANDLERS
	const keyError = ensureApiKey(request)
	if (keyError) return keyError

	const handler = HANDLERS[tag]
	if (!handler) return null

	return handler(request)
}

/** 匹配 <moltbook_xxx ... /> 或 <moltbook_xxx ...>...</moltbook_xxx>，使用命名捕获。 */
const MOLTBOOK_TAG_REGEX = /<moltbook_(?<tag>\w+)(?<attrs>\s*[^>]*?)(?:\/>|>(?<body>[\S\s]*?)<\/moltbook_\k<tag>>)/gi

/**
 * Moltbook ReplyHandler：解析 result.content 中所有 <moltbook_*> 标签。
 * @type {import('../../../../decl/PluginAPI.ts').ReplyHandler_t}
 * @returns {Promise<boolean>} 若处理了标签并需重新生成则为 true，否则 false。
 */
export async function moltbookReplyHandler(reply, args) {
	const content = reply?.content ?? ''
	const matches = [...content.matchAll(MOLTBOOK_TAG_REGEX)]
	if (matches.length === 0) return false

	const addLog = args.AddLongTimeLog
	if (!addLog) return false

	const charName = args.Charname ?? args.char_id ?? 'char'

	addLog({
		name: charName,
		role: 'char',
		content: matches.map(m => m[0]).join('\n\n'),
		files: [],
	})

	for (const match of matches) try {
		const tag = match.groups?.tag?.toLowerCase() ?? ''
		const request = {
			tag,
			attributes: parseAttributes(match.groups?.attrs ?? ''),
			tagBody: match.groups?.body?.trim() ?? '',
			username: args.username,
			char_id: args.char_id,
		}

		const resultContent = await runTag(request)
		if (resultContent) addLog({
			name: 'moltbook',
			role: 'tool',
			content: resultContent,
			files: [],
		})
	}
	catch (err) {
		addLog({
			name: 'moltbook',
			role: 'tool',
			content: `执行出错: ${err?.message ?? err}`,
			files: [],
		})
	}

	return true
}
