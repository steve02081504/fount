import { createLongTimeLogger, runBeforeReplyHooks, runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'

/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/**
 * 加载本角色声明的插件。
 * @param {string} username - 用户名。
 * @param {string[]} names - 插件名列表。
 * @returns {Promise<object>} 插件表（名 -> 部件实例）。
 */
async function loadPlugins(username, names) {
	const { loadPart } = await import('fount/server/parts_loader.mjs')
	return Object.fromEntries(await Promise.all(names.map(async name => [name, await loadPart(username, 'plugins/' + name)])))
}

/**
 * chat `<set-workdir>` 持久化 fixture（脚本角色，不接 AI）：
 * 首轮把工作目录切到 `FOUNT_TEST_SET_WORKDIR_TARGET`，随后读该目录下的 `note.txt`；
 * 目标目录由测试经环境变量注入，跨生成沿用会话记忆里的 workdir。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'SetWorkdir Agent',
			avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			description: 'set-workdir persistence fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * 固定回复；回复意愿恒为 true，保证消息一定触发本 fixture 生成。
			 * @returns {Promise<boolean>} 总是回复。
			 */
			OnMessage: async () => true,
			/**
			 * 按轮次下发 `<set-workdir>` / `<view-file>`，并像真实模板一样驱动 ReplyHandler。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				const target = process.env.FOUNT_TEST_SET_WORKDIR_TARGET
				args.plugins = { ...args.plugins, ...await loadPlugins(args.username, ['file-operations']) }
				/** @type {object} */
				const result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				const prompt_struct = { chat_log: [], char_prompt: { additional_chat_log: [] } }
				const AddLongTimeLog = createLongTimeLogger(args, result, prompt_struct)
				await runBeforeReplyHooks({ ...args, prompt_struct, AddLongTimeLog })
				const handlers = Object.values(args.plugins || {}).map(plugin => plugin.interfaces?.chat?.ReplyHandler).filter(Boolean)
				regen: while (true) {
					const memoryWorkdir = args.chat_scoped_char_memory?.workdir?.path
					const viewed = result.logContextBefore.some(entry => entry.name === 'file-operations.view-file')
					// 脚本角色不接 AI：历史里已下发过 <set-workdir> 就不再重复下发，
					// 否则第二次生成会重新设置工作目录，掩盖“请求未沿用持久化 workdir”的缺陷。
					const edited = result.logContextBefore.some(entry => entry.name === 'file-operations.set-workdir')
						|| (args.chat_log || []).some(entry => entry.name === 'file-operations.set-workdir')
					let text
					if (!memoryWorkdir && !edited && target) text = `<set-workdir path="${target}"></set-workdir>`
					else if (!viewed) text = '<view-file>note.txt</view-file>'
					else text = '完成'
					result.content = text
					delete result.content_for_show
					if (await runReplyHandlers(result, { ...args, prompt_struct, AddLongTimeLog }, handlers))
						continue regen
					break
				}
				return result
			},
		},
	},
}
