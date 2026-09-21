/**
 * 【文件】src/public/parts/plugins/sub-agent/main.mjs
 * 【职责】sub-agent 插件入口：暴露配置接口（批次默认轮次/时长、最大深度、档案条数）与聊天接口（GetPrompt、ReplyHandler）。
 * 【原理】配置读写委托给 state.mjs 的纯配置存储，保证 runtime/prompt 无需 import 本模块即可读取；ReplyHandler 由 handler.mjs 提供。
 * 【数据结构】default export 实现 PluginAPI_t：{ info, Load, Unload, interfaces: { config, chat } }。
 * 【关联】handler.mjs、prompt.mjs、state.mjs；插件加载见 src/server/parts_loader.mjs。
 */
import { subAgentReplyHandlers } from './handler.mjs'
import { getSubAgentPrompt } from './prompt.mjs'
import { getSubAgentConfig, setSubAgentConfig } from './state.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 插件加载钩子。
 * @returns {Promise<void>}
 */
export async function Load() { }

/**
 * 插件卸载钩子。
 * @returns {Promise<void>}
 */
export async function Unload() { }

/**
 *
 */
export default {
	info,
	Load,
	Unload,
	interfaces: {
		config: {
			/**
			 * 读取插件配置。
			 * @returns {Promise<object>} 当前配置（含默认值）
			 */
			GetData: async () => ({ ...getSubAgentConfig() }),
			/**
			 * 写入插件配置。
			 * @param {object} data 配置补丁
			 * @returns {Promise<void>}
			 */
			SetData: async data => {
				setSubAgentConfig(data)
			},
		},
		chat: {
			GetPrompt: getSubAgentPrompt,
			ReplyHandler: subAgentReplyHandlers,
		},
	},
}
