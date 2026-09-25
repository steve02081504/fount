/**
 * 【文件】main.mjs — context-compress 插件入口
 * 【职责】导出插件 info 与 interfaces：聊天 GetPrompt（工具说明）、TweakPrompt（占用提示）、ReplyHandler（`<compress-context/>`）、GetReplyPreviewUpdater，以及可选的 threshold 配置。
 * 【原理】用 `defineReplyHandlers` 打包单个标签 handler；`GetReplyPreviewUpdater` 复用同一批 handler 派生流式预览；
 *   GetPrompt 只产出稳定工具说明，占用提示在 TweakPrompt 阶段用已装配的 prompt_struct 权威统计后原地写入尾部条目。
 *   `interfaces.config` 经 state 读写压缩阈值，parts_loader 加载后以持久化 parts_config 注入。
 * 【数据结构】PluginAPI_t（见 decl/pluginAPI.ts）。
 * 【关联】handler.mjs、prompt.mjs、state.mjs、chat 的 defineReplyHandler / replyPreviews。
 */

import { defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../shells/chat/src/streaming/index.mjs'

import { compressContextReplyHandler } from './handler.mjs'
import { applyContextUsageHint, getContextCompressPrompt } from './prompt.mjs'
import { getConfig, setConfig } from './state.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/** 插件聊天接口使用的 handler 组。 */
const replyHandlers = defineReplyHandlers([compressContextReplyHandler])

/**
 * context-compress 插件主模块。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t} 插件 API 对象
 */
export default {
	info,
	interfaces: {
		config: {
			/**
			 * 读取插件配置（压缩阈值）。
			 * @returns {Promise<{ threshold: number }>} 配置副本
			 */
			GetData: async () => getConfig(),
			/**
			 * 写入插件配置（压缩阈值）。
			 * @param {{ threshold?: unknown } | null | undefined} data 配置数据
			 * @returns {Promise<void>}
			 */
			SetData: async data => { setConfig(data) },
		},
		chat: {
			GetPrompt: getContextCompressPrompt,
			/**
			 * 用已装配的 prompt_struct 统计真实占用，并把占用条目原地写入 / 更新到本插件的 prompt 段。
			 * @param {import('../../../../decl/chatLog.ts').chatReplyRequest_t} args 请求上下文
			 * @param {import('../../../../decl/prompt_struct.ts').prompt_struct_t} promptStruct 已装配的 prompt 结构
			 * @param {import('../../../../decl/prompt_struct.ts').single_part_prompt_t} myPrompt 本插件的 prompt 段
			 * @returns {void}
			 */
			TweakPrompt: (args, promptStruct, myPrompt) => { applyContextUsageHint(args, promptStruct, myPrompt) },
			ReplyHandler: replyHandlers,
			/**
			 * 由同一批 handler 派生回复预览更新器。
			 * @param {Function} [next] 上一个更新器
			 * @returns {Function} 新的预览更新器
			 */
			GetReplyPreviewUpdater: next => defineReplyPreviews(replyHandlers)(next),
		},
	},
}
