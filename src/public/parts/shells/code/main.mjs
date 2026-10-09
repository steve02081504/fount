import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import process from 'node:process'

import open from 'npm:open'

import { generateAccessToken } from '../../../../server/auth/index.mjs'
import { config } from '../../../../server/server.mjs'
import { loadShellData, assignShellData } from '../../../../server/setting_loader.mjs'
import { dispatchRemoteStreamOutput } from '../../plugins/file-operations/src/remote_stream.mjs'

import { CLI_HELP, parseCodeArgs, shouldUseCodeCli } from './cli/args.mjs'
import { resolveCodeWorkspace } from './cli/workspace.mjs'
import { requestExternalOpen, resumeCodeJob, setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default
const baseUrl = `http://localhost:${config.port ?? 8931}`

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
		workspace = { id: randomUUID().slice(0, 8), name: basename(cwd) || cwd, machine: '0', path: cwd, lastUsedAt: new Date().toISOString() }
		data.list.push(workspace)
		assignShellData(username, 'code', 'workspaces', data)
	}
	return workspace.id
}

/**
 * 解析 `fount run code` 参数：`--prompt|-p`、`--workspace|-w`（也支持 `--k=v`）。
 * @param {string[]} args - 参数列表。
 * @returns {{prompt: string, workspace: string}} 解析结果（缺省空）。
 */
function parseRunArgs(args = []) {
	let prompt = ''
	let workspace = ''
	for (let i = 0; i < args.length; i++) {
		const arg = String(args[i])
		const eq = arg.indexOf('=')
		const name = eq !== -1 ? arg.slice(0, eq) : arg
		const inline = eq !== -1 ? arg.slice(eq + 1) : null
		if (name === '--prompt' || name === '-p') {
			prompt = inline ?? String(args[++i] ?? '')
			continue
		}
		if (name === '--workspace' || name === '-w') {
			workspace = inline ?? String(args[++i] ?? '')
			continue
		}
	}
	return { prompt, workspace }
}

/**
 * CLI `fount run code [--prompt <text>] [--workspace <path>]`：以探测到的 Git 根目录（无则 cwd，显式路径跳过探测）为工作区打开 code 页面，
 * 带 `--prompt` 时在已有页面新开对话并聚焦，无页面在线则打开带 `?prompt=` 的新页面。
 * @param {string} username - 用户名。
 * @param {string[]} args - 参数。
 * @param {{cwd?: string}} [context] - 调用上下文（IPC runpart 携带 CLI cwd）。
 * @returns {Promise<void>} 打开完成。
 */
async function openCodePage(username, args, context = {}) {
	const cwd = context.cwd || process.cwd()
	const { prompt, workspace } = parseRunArgs(args)
	const targetCwd = resolveCodeWorkspace(cwd, workspace)
	const workspaceId = ensureWorkspace(username, targetCwd)
	const url = `${baseUrl}/parts/shells:code/?workspace=${encodeURIComponent(workspaceId)}`
	console.log(`Opening code shell in workspace: ${targetCwd}`)
	if (prompt) {
		if (await requestExternalOpen(username, { workspaceId, prompt })) return
		await open(`${url}&prompt=${encodeURIComponent(prompt)}`)
		return
	}
	await open(url)
}

/**
 * 让调用方进程加载 CLI 模块，并把用法错误交给它按 CLI 规则打印（退出码由模块决定）。
 * @param {string[]} args - 原始参数。
 * @param {string} message - 用法错误信息。
 * @returns {{type: 'run-js', module: string, args: string[], data: object}} 执行描述符。
 */
function cliUsageError(args, message) {
	return { type: 'run-js', module: 'cli/main.mjs', args, data: { usageError: message } }
}

/**
 * 为用户签发短期访问令牌。
 * @param {string} username - 用户名。
 * @returns {Promise<string>} 访问令牌。
 */
const issueAccessToken = username => generateAccessToken({ username, userId: config.data.users[username].auth.userId })

/**
 * `fount run code` 入口：无终端开关时打开网页；带 `--cli` / `--print` / `--help` 时准备用户与工作区数据，
 * 返回交给调用方进程执行的模块描述符。
 * @param {string} username - 服务端解析后的执行用户名。
 * @param {string[]} args - `fount run code` 之后的原始参数。
 * @param {{cwd?: string}} [context] - 调用上下文（IPC runpart 携带 CLI cwd）。
 * @returns {Promise<import('../../../../decl/shellAPI.ts').ArgumentsResult>} 打开网页，或返回 output / run-js 执行描述符。
 */
async function handleCodeArguments(username, args, context = {}) {
	if (!shouldUseCodeCli(args)) return openCodePage(username, args, context)
	let parsed
	try { parsed = parseCodeArgs(args) }
	catch (error) { return cliUsageError(args, error.message) }
	if (parsed.help) return { type: 'output', content: CLI_HELP }
	let workspaceId = parsed.workspaceId
	if (workspaceId) {
		const workspaces = loadShellData(username, 'code', 'workspaces')?.list ?? []
		if (!workspaces.some(workspace => workspace.id === workspaceId)) return cliUsageError(args, `workspace not found: ${workspaceId}`)
	}
	else workspaceId = ensureWorkspace(username, resolveCodeWorkspace(context.cwd || process.cwd(), parsed.workspace))
	return {
		type: 'run-js', module: 'cli/main.mjs', args,
		data: { username, workspaceId, baseUrl, accessToken: await issueAccessToken(username) },
	}
}

/**
 * code shell 入口：AI 编码会话。
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
		jobs: {
			/**
			 * 唤醒退出前正在生成的会话。
			 * @param {string} username - 用户名。
			 * @param {object} data - 保存的生成参数。
			 * @returns {void} 恢复在后台运行。
			 */
			ReStartJob: (username, data) => resumeCodeJob(username, data),
			/** @returns {void} 关闭屏障统一处理所有进行中的生成。 */
			PauseJob: () => { },
		},
		/**
		 * 分机回调：接收远程流式执行经 `callback` 回传的输出分片并按 execId 分派。
		 */
		subfount: {
			/**
			 * 处理分机经 `callback` 回传的流式输出。
			 * @param {{data?: object}} payload - 回调载荷（`data` 为 `{ execId, stream, data }`）。
			 * @returns {void}
			 */
			RemoteCallBack: ({ data }) => { dispatchRemoteStreamOutput(data) },
		},
		invokes: {
			/**
			 * 处理 CLI / IPC 参数：默认探测 Git 根目录作为工作区打开 code 页面；CLI 开关则返回客户端执行描述符。
			 * @param {string} user - 用户名。
			 * @param {string[]} args - 参数。
			 * @param {{cwd?: string}} context - 调用上下文。
			 * @returns {Promise<import('../../../../decl/shellAPI.ts').ArgumentsResult>} 打开完成或执行描述符。
			 */
			ArgumentsHandler: handleCodeArguments,
			/**
			 * 处理 IPC 调用：`{ operation: 'cli-token' }` 换取短期访问令牌，其余以 { cwd, prompt?, workspace? } 在工作区打开 code 页面。
			 * @param {string} user - 用户名。
			 * @param {{cwd?: string, prompt?: string, workspace?: string, operation?: string}} data - 调用数据。
			 * @returns {Promise<void|{accessToken: string}>} 打开完成或新令牌。
			 */
			IPCInvokeHandler: async (user, data = {}) => {
				if (data.operation === 'cli-token') return { accessToken: await issueAccessToken(user) }
				const args = []
				if (data.prompt) args.push('--prompt', String(data.prompt))
				if (data.workspace) args.push('--workspace', String(data.workspace))
				return openCodePage(user, args, data)
			},
		},
	},
}
