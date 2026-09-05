import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import process from 'node:process'

import open from 'npm:open'

import { config } from '../../../../server/server.mjs'
import { loadShellData, saveShellData } from '../../../../server/setting_loader.mjs'

import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 部件信息类型别名。
 * @typedef {import('../../../../decl/basedefs.ts').info_t} info_t
 */

/**
 * 确保 cwd 作为本机工作区注册（无则新建）。
 * @param {string} username - 用户名。
 * @param {string} cwd - 目录绝对路径。
 * @returns {string} 工作区 id。
 */
function ensureWorkspace(username, cwd) {
	const data = loadShellData(username, 'code', 'workspaces') ?? {}
	data.list ??= []
	let workspace = data.list.find(w => w.machine === '0' && w.path === cwd)
	if (!workspace) {
		workspace = { id: randomUUID().slice(0, 8), name: basename(cwd) || cwd, machine: '0', path: cwd }
		data.list.push(workspace)
		saveShellData(username, 'code', 'workspaces', data)
	}
	return workspace.id
}

/**
 * CLI `fount run <user> shells/code`：以调用方 cwd 为工作区打开 code 页面。
 * @param {string} username - 用户名。
 * @param {string[]} _args - 参数（未用）。
 * @param {{cwd?: string}} [context] - 调用上下文（IPC runpart 携带 CLI cwd）。
 * @returns {Promise<void>} 打开完成。
 */
async function openCodePage(username, _args, context = {}) {
	const cwd = context.cwd || process.cwd()
	const workspaceId = ensureWorkspace(username, cwd)
	const port = config.port ?? 8931
	const url = `http://localhost:${port}/parts/shells:code/?workspace=${encodeURIComponent(workspaceId)}`
	console.log(`Opening code shell in workspace: ${cwd}`)
	await open(url)
}

/**
 * code shell 入口：AI 编码会话（opencode 风格 web 界面）。
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载 code shell 并设置 API 端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express 的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
		invokes: {
			/**
			 * 处理 CLI / IPC 参数：以 cwd 为工作区打开 code 页面。
			 * @param {string} user - 用户名。
			 * @param {string[]} args - 参数。
			 * @param {{cwd?: string}} context - 调用上下文。
			 * @returns {Promise<void>} 打开完成。
			 */
			ArgumentsHandler: openCodePage,
			/**
			 * 处理 IPC 调用：以 { cwd } 为工作区打开 code 页面。
			 * @param {string} user - 用户名。
			 * @param {{cwd?: string}} data - 调用数据。
			 * @returns {Promise<void>} 打开完成。
			 */
			IPCInvokeHandler: async (user, data) => openCodePage(user, [], data || {}),
		},
	},
}
