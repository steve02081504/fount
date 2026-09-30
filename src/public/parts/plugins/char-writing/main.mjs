/**
 * char-writing 插件入口：向角色注入「角色 / 用户人设创作」能力说明。
 * 只提供 decl 与样例目录路径，实际落盘交由 file-operations 等文件插件完成。
 */
import { getCharWritingPrompt } from './prompt.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * char-writing 插件默认导出：仅暴露聊天提示接口。
 * @type {import('../../../../decl/pluginAPI.ts').PluginAPI_t}
 */
export default {
	info,
	interfaces: {
		chat: {
			GetPrompt: getCharWritingPrompt,
		},
	},
}
