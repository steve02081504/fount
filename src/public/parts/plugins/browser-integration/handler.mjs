import { Buffer } from 'node:buffer'
import util from 'node:util'

import { defineReplyHandler, defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'

import { getChannels, registerChannel } from './state.mjs'

/** 本插件在部件树中的路径，用于浏览器 JS 回调。 */
export const PLUGIN_PATH = 'plugins/browser-integration'

/**
 * 默认按需加载浏览器集成 shell 的 API。
 * @returns {Promise<object>} 浏览器集成 API 模块。
 */
function defaultGetApi() {
	return import('../../shells/browserIntegration/src/api.mjs')
}

/**
 * 追加一条浏览器集成工具日志（人类展示层包进代码块，避免被 markdown / HTML 解析）。
 * @param {object} args - 回复请求上下文。
 * @param {string} name - 工具名。
 * @param {string} content - 提供给角色的日志正文。
 * @param {string} [contentForShow=content] - 人类展示层正文。
 * @param {object[]} [files] - 结果附件。
 * @returns {void}
 */
function logBrowserTool(args, name, content, contentForShow = content, files = []) {
	args.AddLongTimeLog?.({
		name,
		role: 'tool',
		content,
		content_for_show: renderMarkdownCodeBlock(contentForShow, { lang: 'text' }),
		files,
	})
}

/**
 * 将页面 ID（可为 'focused' / 'mostRecent'）解析为数字 ID。
 * @param {object} api - 浏览器集成 API 模块。
 * @param {string} username - 用户名。
 * @param {string} pageIdRaw - 原始页面 ID 字符串。
 * @returns {number} 解析后的数字页面 ID。
 */
export function resolvePageId(api, username, pageIdRaw) {
	const raw = String(pageIdRaw ?? '').trim()
	if (!raw) throw new Error('缺少页面 ID。')
	if (raw.toLowerCase() === 'focused') {
		const focusedPage = api.getFocusedPageInfo(username)
		if (focusedPage) return focusedPage.id
		throw new Error('没有找到焦点页面。')
	}
	if (raw.toLowerCase() === 'mostrecent') {
		const mostRecentPage = api.getMostRecentPageInfo(username)
		if (mostRecentPage) return mostRecentPage.id
		throw new Error('没有找到最近访问的页面。')
	}
	const id = Number(raw)
	if (!Number.isFinite(id)) throw new Error(`无法解析页面 ID：“${raw}”。`)
	return id
}

/**
 * 解析 `<tag>值</tag>` 形式的单个字段。
 * @param {string} content - 调用体内文本。
 * @param {string} tag - 标签名。
 * @returns {string | undefined} 去空白后的字段值。
 */
function parseTag(content, tag) {
	return content.match(new RegExp(`<${tag}>([\\S\\s]*?)</${tag}>`))?.[1]?.trim()
}

/**
 * 解析弹幕参数。
 * @param {string} content - 调用体内文本。
 * @returns {{ content: string, speed?: number, color?: string, fontSize?: number, yPos?: number }} 弹幕选项。
 */
export function parseDanmakuOptions(content) {
	const danmakuContent = parseTag(content, 'content')
	if (!danmakuContent) throw new Error('请求中缺少 <content> 标签。')
	const options = { content: danmakuContent }
	const speed = parseTag(content, 'speed')
	if (speed !== undefined) options.speed = Number(speed)
	const color = parseTag(content, 'color')
	if (color !== undefined) options.color = color
	const fontSize = parseTag(content, 'fontSize')
	if (fontSize !== undefined) options.fontSize = Number(fontSize)
	const yPos = parseTag(content, 'yPos')
	if (yPos !== undefined) options.yPos = Number(yPos)
	return options
}

/**
 * 创建浏览器集成工具处理器。
 * @param {object} [options] - 依赖项。
 * @param {() => Promise<object>} [options.getApi] - 获取浏览器集成 API 模块。
 * @returns {import('../../../../decl/pluginAPI.ts').ReplyHandler_t} 浏览器集成回复处理器。
 */
export function createBrowserIntegrationReplyHandler({ getApi = defaultGetApi } = {}) {
	/**
	 * 构造一个把操作结果写入工具日志的标签 handler。
	 * @param {string} tag - 标签名。
	 * @param {string} name - 工具名。
	 * @param {string} command - 命令名（用于错误信息）。
	 * @param {(args: object, call: object) => Promise<string>} action - 返回日志正文的操作。
	 * @returns {object} 标签 handler。
	 */
	function makeCommandHandler(tag, name, command, action) {
		return defineReplyHandler({
			tag,
			name,
			/**
			 * 执行浏览器操作并记录工具日志。
			 * @param {object} _reply - 回复对象。
			 * @param {object} args - 请求上下文。
			 * @param {object} call - 已解析的调用。
			 * @returns {Promise<{regen: boolean}>} 要求模型继续生成。
			 */
			handle: async (_reply, args, call) => {
				try {
					const content = await action(args, call)
					logBrowserTool(args, name, content)
				}
				catch (error) {
					console.error(`Error executing browser integration command "${command}":`, error)
					logBrowserTool(args, name, `执行 ${command} 时出错：\n${error?.stack || error?.message || error}`)
				}
				return { regen: true }
			},
		})
	}

	const registerChannelHandler = defineReplyHandler({
		/**
		 * 内容型 handler：注册支持追加消息的活跃频道，供 JS 回调使用。
		 * @param {object} _reply - 回复对象。
		 * @param {object} args - 请求上下文。
		 * @returns {Promise<object>} 结果。
		 */
		handle: async (_reply, args) => {
			if (args.supported_functions?.add_message)
				registerChannel(args.username, args.char_id, args)
			return {}
		},
	})

	const getConnectedPagesHandler = makeCommandHandler(
		'browser-get-connected-pages', 'browser-integration.get-connected-pages', 'get-connected-pages',
		async args => {
			const api = await getApi()
			return '已连接的页面列表：\n' + util.inspect(api.getConnectedPages(args.username), { depth: 4 })
		},
	)

	const getFocusedPageInfoHandler = makeCommandHandler(
		'browser-get-focused-page-info', 'browser-integration.get-focused-page-info', 'get-focused-page-info',
		async args => {
			const api = await getApi()
			return '当前焦点页面信息：\n' + util.inspect(api.getFocusedPageInfo(args.username), { depth: 4 })
		},
	)

	const getBrowseHistoryHandler = makeCommandHandler(
		'browser-get-browse-history', 'browser-integration.get-browse-history', 'get-browse-history',
		async args => {
			const api = await getApi()
			return '浏览历史：\n' + util.inspect(api.getBrowseHistory(args.username), { depth: 4 })
		},
	)

	const getPageHtmlHandler = defineReplyHandler({
		tag: 'browser-get-page-html',
		name: 'browser-integration.get-page-html',
		/**
		 * 获取页面完整 HTML 并作为文件附件。
		 * @param {object} _reply - 回复对象。
		 * @param {object} args - 请求上下文。
		 * @param {object} call - 已解析的调用。
		 * @returns {Promise<{regen: boolean}>} 要求模型继续生成。
		 */
		handle: async (_reply, args, call) => {
			try {
				const api = await getApi()
				const pageId = resolvePageId(api, args.username, call.inner)
				const html = await api.getPageHtml(args.username, pageId)
				logBrowserTool(args, 'browser-integration.get-page-html',
					`页面 ${pageId} 的 HTML 内容已作为文件附件提供。`,
					`页面 ${pageId} 的 HTML 内容已作为文件附件提供。`,
					[{ name: `page-${pageId}.html`, buffer: Buffer.from(html.html, 'utf-8'), mime_type: 'text/html' }],
				)
			}
			catch (error) {
				console.error('Error executing browser integration command "get-page-html":', error)
				logBrowserTool(args, 'browser-integration.get-page-html', `执行 get-page-html 时出错：\n${error?.stack || error?.message || error}`)
			}
			return { regen: true }
		},
	})

	const getVisibleHtmlHandler = makeCommandHandler(
		'browser-get-visible-html', 'browser-integration.get-visible-html', 'get-visible-html',
		async (args, call) => {
			const api = await getApi()
			const pageId = resolvePageId(api, args.username, call.inner)
			const html = await api.getVisibleHtml(args.username, pageId)
			return `页面 ${pageId} 的可见 HTML 内容：\n${html.html}\n`
		},
	)

	const sendDanmakuHandler = makeCommandHandler(
		'browser-send-danmaku-to-page', 'browser-integration.send-danmaku-to-page', 'send-danmaku-to-page',
		async (args, call) => {
			const api = await getApi()
			const pageId = resolvePageId(api, args.username, parseTag(call.inner, 'pageId'))
			const danmakuOptions = parseDanmakuOptions(call.inner)
			await api.sendDanmakuToPage(args.username, pageId, danmakuOptions)
			return `已在页面 ${pageId} 发送弹幕：${util.inspect(danmakuOptions)}`
		},
	)

	const runJsOnPageHandler = makeCommandHandler(
		'browser-run-js-on-page', 'browser-integration.run-js-on-page', 'run-js-on-page',
		async (args, call) => {
			const api = await getApi()
			const pageId = resolvePageId(api, args.username, parseTag(call.inner, 'pageId'))
			const script = parseTag(call.inner, 'script')
			if (script === undefined) throw new Error('请求中缺少 <script> 标签。')
			const result = await api.runJsOnPage(args.username, pageId, script, { partpath: PLUGIN_PATH, char_id: args.char_id })
			return `在页面 ${pageId} 上运行 JS 的结果：\n` + util.inspect(result, { depth: 4 })
		},
	)

	const addAutoRunScriptHandler = makeCommandHandler(
		'browser-add-autorun-script', 'browser-integration.add-autorun-script', 'add-autorun-script',
		async (args, call) => {
			const api = await getApi()
			const urlRegex = parseTag(call.inner, 'urlRegex')
			const script = parseTag(call.inner, 'script')
			if (urlRegex === undefined || script === undefined) throw new Error('请求中缺少 <urlRegex> 或 <script> 标签。')
			const newScript = api.addAutoRunScript(args.username, {
				urlRegex,
				script,
				comment: parseTag(call.inner, 'comment') || '',
			})
			return '已添加自动运行脚本：\n' + util.inspect(newScript, { depth: 4 })
		},
	)

	const updateAutoRunScriptHandler = makeCommandHandler(
		'browser-update-autorun-script', 'browser-integration.update-autorun-script', 'update-autorun-script',
		async (args, call) => {
			const api = await getApi()
			const id = parseTag(call.inner, 'id')
			if (id === undefined) throw new Error('缺少 <id> 标签。')
			const urlRegex = parseTag(call.inner, 'urlRegex')
			const script = parseTag(call.inner, 'script')
			const comment = parseTag(call.inner, 'comment')
			if (urlRegex === undefined && script === undefined && comment === undefined)
				throw new Error('必须提供 <urlRegex>、<script> 或 <comment> 标签中的至少一个。')
			const fields = {}
			if (urlRegex !== undefined) fields.urlRegex = urlRegex
			if (script !== undefined) fields.script = script
			if (comment !== undefined) fields.comment = comment
			const updatedScript = api.updateAutoRunScript(args.username, id, fields)
			return '已更新自动运行脚本：\n' + util.inspect(updatedScript, { depth: 4 })
		},
	)

	const removeAutoRunScriptHandler = makeCommandHandler(
		'browser-remove-autorun-script', 'browser-integration.remove-autorun-script', 'remove-autorun-script',
		async (args, call) => {
			const api = await getApi()
			const id = parseTag(call.inner, 'id')
			if (id === undefined) throw new Error('缺少 <id> 标签。')
			api.removeAutoRunScript(args.username, id)
			return `已删除自动运行脚本（id：${id}）。`
		},
	)

	const listAutoRunScriptsHandler = makeCommandHandler(
		'browser-list-autorun-scripts', 'browser-integration.list-autorun-scripts', 'list-autorun-scripts',
		async args => {
			const api = await getApi()
			return '自动运行脚本列表：\n' + util.inspect(api.listAutoRunScripts(args.username), { depth: 4 })
		},
	)

	return defineReplyHandlers([
		registerChannelHandler,
		getConnectedPagesHandler,
		getFocusedPageInfoHandler,
		getBrowseHistoryHandler,
		getPageHtmlHandler,
		getVisibleHtmlHandler,
		sendDanmakuHandler,
		runJsOnPageHandler,
		addAutoRunScriptHandler,
		updateAutoRunScriptHandler,
		removeAutoRunScriptHandler,
		listAutoRunScriptsHandler,
	])
}

/**
 * 处理来自浏览器 JS 的回调：向该角色最近的活跃频道注入系统条目以触发回复。
 * @param {object} payload - 回调数据。
 * @param {string} payload.username - 用户名。
 * @param {any} payload.data - 浏览器脚本返回的数据。
 * @param {number} payload.pageId - 发生回调的页面 ID。
 * @param {string} payload.script - 触发回调的原始脚本。
 * @param {string} [payload.char_id] - 请求回调的角色 ID。
 * @returns {Promise<void>} 处理完成。
 */
export async function handleBrowserJsCallback({ username, data, pageId, script, char_id }) {
	const channels = getChannels(username, char_id)
	if (!channels.length) {
		console.warn(`browser-integration: 收到浏览器回调但无活跃频道（username=${username}, char_id=${char_id ?? '未知'}）`)
		return
	}
	const content = `\
浏览器 JS 脚本中的 callback 函数被调用了。
页面 ID：${pageId}
此前执行的脚本：
\`\`\`javascript
${script}
\`\`\`
脚本返回的数据：
\`\`\`json
${util.inspect(data, { depth: null })}
\`\`\`
请根据 callback 的内容进行回复。
`
	const entry = {
		name: 'system',
		uid: 'system',
		role: 'system',
		content,
		content_for_show: renderMarkdownCodeBlock(content, { lang: 'text' }),
		files: [],
	}
	if (char_id) entry.charVisibility = [char_id]
	await channels[0].AddChatLogEntry?.(entry)
}
