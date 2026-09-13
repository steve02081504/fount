import { chatReply_t, chatReplyRequest_t, CharReplyPreviewUpdater_t } from '../public/parts/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

/**
 * 叶子回复处理程序（ReplyHandler）的规范描述符。
 *
 * 由 `defineReplyHandler` 生成，或按此形状手写。管线 `runReplyHandlers` 按 `level` 升序分组驱动：
 * - 有 `pattern` 者解析并整段消耗一次调用（`call = { name, tag?, params, body, raw, start, end, occurrence, value?, error? }`）；
 * - 省略 `pattern` 者为内容型 handler，`handle(reply, args, null)` 作用于整条 `reply.content`；
 * - `evaluate` 在流式期提前求值并缓存于 `args.extension.evaluatedToolCalls`，`handle` 经 `call.value` 复用；
 * - `display(call, state, args)` 决定该调用段在人类展示层的呈现（`state = { stage, open, value?, error? }`）；
 * - `parallel` 声明与其他 handler 的并行兼容性：`true` = 与任何启用并行者兼容，`string[]` = 只与列出的 handler 名双向兼容；未声明即屏障（串行）；
 * - `handle` 返回 `{ regen?, content?, stop? }`：`regen` 建议下一轮生成、`content` 整条替换 `reply.content`、`stop` 立即终止本轮。
 */
export type ReplyHandlerLeaf_t = {
	/** 可读标识（日志标签 / 求值缓存键）。 */
	name: string
	/** 识别与解析一次调用的模式；省略即内容型 handler。 */
	pattern?: {
		tag: string
		params?: Record<string, string>
		body?: 'text' | 'lines' | 'children' | ((inner: string, call: any) => any)
	} | RegExp | { start: string | RegExp, end: string | RegExp } | ((content: string, args: any) => any[])
	/** 执行顺序：越小越先，默认 0。 */
	level: number
	/** 提前求值（流式期即时算并缓存）。 */
	evaluate?: (call: any, args: any) => Promise<any>
	/** 展示层渲染。 */
	display?: (call: any, state: any, args: any) => string
	/** 并行兼容性：`true`=与任何启用并行者兼容；`string[]`=只与列出的 handler 名双向兼容；未声明即屏障（串行）。 */
	parallel?: boolean | string[]
	/** 处理器。返回 `{ regen?, content?, stop? }`。 */
	handle: (
		reply: chatReply_t,
		args: chatReplyRequest_t & { prompt_struct: prompt_struct_t, AddLongTimeLog?: (entry: chatLogEntry_t) => void },
		call: any | null,
	) => Promise<{ regen?: boolean, content?: string, stop?: boolean } | void>
}

/**
 * 回复处理程序：叶子描述符，或由 `defineReplyHandlers` 打包的组合节点。
 * 组合节点自身不执行，管线/预览会递归展开其中的 `handlers`。
 */
export type ReplyHandler_t = ReplyHandlerLeaf_t | { handlers: ReplyHandler_t[] }

/**
 * 插件API接口
 * @class PluginAPI_t
 * 定义了插件的 API 结构。
 */
export class PluginAPI_t {
	/**
	 * 插件的详细信息。
	 */
	info: info_t
	/**
	 * 初始化插件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * 加载插件。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
	/**
	 * 卸载插件。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * 卸载插件。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * 插件支持的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新插件的信息。
		 */
		info?: {
			/**
			 * 更新插件的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的插件信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		/**
		 * 配置接口，用于获取和设置配置数据。
		 */
		config?: {
			/**
			 * 获取配置数据。
			 * @returns {Promise<any>} - 配置数据。
			 */
			GetData: () => Promise<any>
			/**
			 * 设置配置数据。
			 * @param {any} data - 要设置的配置数据。
			 * @returns {Promise<void>}
			 */
			SetData: (data: any) => Promise<void>
		},
		/**
		 * 聊天接口，用于处理聊天相关的功能。
		 */
		chat?: {
			/**
			 * 在聊天中为角色扩充提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPrompt?: (arg: chatReplyRequest_t) => Promise<single_part_prompt_t>;
			/**
			 * 调整提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {single_part_prompt_t} my_prompt - 我的提示。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<void>} - 无返回值。
			 */
			TweakPrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, my_prompt: single_part_prompt_t, detail_level: number) => Promise<void>
			/**
			 * 处理角色回复的回复处理器（单个叶子或 `defineReplyHandlers` 组合节点）。
			 * @see ReplyHandler_t
			 */
			ReplyHandler?: ReplyHandler_t

			/**
			 * 获取回复预览更新器。
			 * @param {CharReplyPreviewUpdater_t} [updater] - 上一个更新器。
			 * @returns {CharReplyPreviewUpdater_t} - 新的更新器。
			 */
			GetReplyPreviewUpdater?: (updater?: CharReplyPreviewUpdater_t) => CharReplyPreviewUpdater_t
		},
		/**
		 * 代码执行接口，用于处理代码执行相关的功能。
		 */
		code_execution?: {
			/**
			 * 此函数在合适时机扩充至角色的有关代码运行的提示中，为角色更好掌握代码运行的上下文提供基础。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<string | undefined>} - JavaScript 代码提示或 undefined。
			 */
			GetJSCodePrompt?: (arg: chatReplyRequest_t) => Promise<string | undefined>;
			/**
			 * 此函数为角色的代码运行提供特殊变量或函数，允许其在代码中使用。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<Record<string, any>>} - 包含特殊变量或函数的对象。
			 */
			GetJSCodeContext?: (arg: chatReplyRequest_t) => Promise<Record<string, any>>;
		}
	}
}
