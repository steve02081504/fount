/**
 * 【文件】main.mjs — agent_studio shell 入口
 * 【职责】暴露部件信息并挂载 REST 端点。
 * 【原理】`Load({router})` 时调用 `setEndpoints` 注册 `/api/parts/shells:agent_studio/...` 路由；
 *   内部业务模块直接 import（`./src/studio.mjs` 等），不经 `loadPart`，也不暴露 generationHistory 接口。
 * 【关联】src/endpoints.mjs、src/studio.mjs、src/generation_history.mjs。
 */
import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * agent_studio shell：生成历史查看、子代理运行追踪与角色基准测试。
 * @type {import('../../../../../src/decl/shellAPI.ts').shellAPI_t}
 */
export default {
	info,
	/**
	 * 挂载 shell 的 HTTP 端点。
	 * @param {object} root0 参数
	 * @param {object} root0.router Express 路由实例
	 * @returns {void}
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
	},
}
