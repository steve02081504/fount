/**
 * 目标机器/工作目录解析与统一执行器。
 * - 显式指定 `machine`/`workdir`（标签属性或调用参数）优先，缺省读 `args.workdir`（`chatReplyRequest_t` 请求级默认）。
 * - 本机（machine 0 / 未指定）直接走 `node:fs` + `@steve02081504/exec`，行为与历史版本一致；
 *   远程机器走 subfounts 执行器（`executeCodeOnSubfount` / `executeShellOnSubfount`）。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { async_eval } from 'npm:@steve02081504/async-eval'
import { available, exec, shell_exec_map } from 'npm:@steve02081504/exec'

import { executeCodeOnSubfount, executeShellOnSubfount } from '../../../shells/subfounts/src/api.mjs'

/**
 * 目标描述。
 * @typedef {object} target_t
 * @property {string} machine - 目标机器标识（当前为 subfount 数字 id 的十进制字符串，"0" = 本机；string 便于未来扩展）。
 * @property {number} machineId - machine 归一化后的数字 id（当前 subfounts 协议用数字 id）。
 * @property {string} [workdir] - 工作目录（绝对路径；相对路径由目标机器解析）。
 * @property {boolean} remote - 是否远程。
 */

/**
 * 目录条目。
 * @typedef {{name: string, isDirectory: boolean, isFile: boolean}} dirEntry_t
 */

/**
 * 统一目标执行器。
 * @typedef {object} targetExecutor_t
 * @property {(shell: string|null, code: string) => Promise<any>} execShell - 执行 shell（shell 为 null 时按目标机器默认 shell）。
 * @property {(code: string) => Promise<any>} execJs - 执行 JS（返回 EvalResult.result）。
 * @property {(p: string) => Promise<string>} readTextFile - 读文本文件。
 * @property {(p: string) => Promise<Buffer>} readFileBuffer - 读二进制文件。
 * @property {(p: string, content: string) => Promise<void>} writeTextFile - 写文本文件。
 * @property {(p: string) => Promise<dirEntry_t[]>} listDir - 列目录。
 * @property {(p: string) => Promise<{isDirectory: boolean, isFile: boolean} | null>} statEntry - 查看条目。
 * @property {(p: string) => Promise<boolean>} pathExists - 路径是否存在。
 * @property {() => Promise<string[]>} listRoots - 列根（Windows 盘符 / unix `/`）。
 */

/**
 * 解析相对路径，支持 `~` (home) 和 MSYS 风格的路径（仅本机）。
 * @param {string} relativePath - 要解析的相对路径。
 * @returns {string} 解析后的绝对路径。
 */
export function resolveLocalPath(relativePath) {
	if (relativePath.startsWith('~'))
		return path.resolve(path.join(os.homedir(), relativePath.slice(1)))
	const msys_path = process.env.MSYS_ROOT_PATH
	if (msys_path && relativePath.startsWith('/')) {
		if (relativePath.match(/^\/[A-Za-z]\//))
			return path.resolve(path.join(relativePath.slice(1, 2).toUpperCase() + ':\\', relativePath.slice(3)))
		return path.resolve(path.join(msys_path, relativePath))
	}
	return path.resolve(relativePath)
}

/**
 * 轻量拼接基准目录与相对路径，保留分隔符原样（跨平台安全；不解析 `..`/绝对化）。
 * @param {string} [base] - 基准目录。
 * @param {string} rel - 相对（或绝对）路径。
 * @returns {string} 拼接结果。
 */
export function joinWorkdir(base, rel) {
	if (path.isAbsolute(rel) || rel.startsWith('~') || /^[A-Za-z]:[\\/]/.test(rel))
		return rel
	if (!base) return rel
	return base.replace(/[\\/]+$/, '') + (base.endsWith('/') ? '' : '/') + rel.replace(/^[\\/]+/, '')
}

/**
 * 从请求与标签显式参数解析目标。
 * @param {chatReplyRequest_t} [args] - GetReply 请求（读 `args.workdir` 默认值）。
 * @param {{machine?: string|number, workdir?: string}} [explicit] - 标签显式参数。
 * @returns {target_t} 解析后的目标。
 */
export function resolveTarget(args, explicit = {}) {
	const base = args?.workdir || {}
	const machineRaw = explicit.machine ?? base.machine ?? '0'
	const machine = String(machineRaw ?? '0')
	const machineId = Number.parseInt(machine, 10) || 0
	const workdir = explicit.workdir ? joinWorkdir(base.path ?? base.workdir, explicit.workdir) : base.path ?? base.workdir
	return { machine, machineId, workdir, remote: machineId > 0 }
}

/**
 * 本机默认 shell：Windows 用 pwsh，其他平台用 bash。
 * @returns {'pwsh'|'bash'} 默认 shell 名。
 */
export function localDefaultShell() {
	return process.platform === 'win32' ? 'pwsh' : 'bash'
}

/**
 * 查询目标机器的默认 shell（与该机器不带 shell 执行时的回退逻辑一致）。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识（string）。
 * @returns {Promise<string>} 默认 shell 名；远程机器信息不可得（未连接）时为空字符串。
 */
export async function machineDefaultShell(username, machine) {
	const machineId = Number.parseInt(String(machine), 10) || 0
	if (machineId <= 0) {
		const availability = await available
		if (process.platform === 'win32') return availability.pwsh ? 'pwsh' : 'powershell'
		return availability.bash ? 'bash' : 'sh'
	}
	const { getAllSubfounts } = await import('../../../shells/subfounts/src/api.mjs')
	const info = getAllSubfounts(username).find(s => s.id === machineId)
	const shells = info?.deviceInfo?.shells
	if (!shells || typeof shells !== 'object') return ''
	if (info.deviceInfo?.os?.platform === 'win32') return shells.pwsh ? 'pwsh' : 'powershell'
	return shells.bash ? 'bash' : 'sh'
}

/**
 * 查询目标机器可用的 shell 列表（供 UI 下拉 / 默认值回退）。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识（string）。
 * @returns {Promise<string[]>} 可用 shell 名列表（如 pwsh/bash/sh/powershell）。
 */
export async function availableShells(username, machine) {
	const machineId = Number.parseInt(String(machine), 10) || 0
	if (machineId <= 0)
		return Object.keys(shell_exec_map).filter(name => available[name])
	const { getAllSubfounts } = await import('../../../shells/subfounts/src/api.mjs')
	const info = getAllSubfounts(username).find(s => s.id === machineId)
	const shells = info?.deviceInfo?.shells
	if (shells && typeof shells === 'object')
		return Object.keys(shells).filter(name => shells[name])
	return []
}

/**
 * 列出所有可用机器（本机 + 已连接/已断开的 subfount），供 AI 侧 `<list-machines>` 与前端共用。
 * id 归一化为字符串（未来非数字机器标识兼容）。
 * @param {string} username - 用户名。
 * @returns {Promise<Array<{id: string, description: string, isConnected: boolean, deviceInfo: object|null}>>} 机器清单。
 */
export async function listMachines(username) {
	const { getAllSubfounts } = await import('../../../shells/subfounts/src/api.mjs')
	const subfounts = getAllSubfounts(username)
	if (!subfounts.length)
		// 用户管理器不可用（如独立测试环境）时兜底本机：id "0" 始终为当前进程。
		return [{ id: '0', description: 'localhost', isConnected: true, deviceInfo: null }]
	return subfounts.map(s => ({
		id: String(s.id),
		description: s.description || (s.id === 0 ? 'localhost' : `#${s.id}`),
		isConnected: s.isConnected,
		deviceInfo: s.deviceInfo || null,
	}))
}

/**
 * 解包 async_eval 的 EvalResult，错误时抛出。
 * @param {{error?: unknown, result?: any}|any} evalResult - EvalResult。
 * @returns {any} result 值。
 */
function unwrapEval(evalResult) {
	if (evalResult && typeof evalResult === 'object' && 'error' in evalResult && evalResult.error)
		throw evalResult.error instanceof Error ? evalResult.error : new Error(String(evalResult.error?.stack || evalResult.error))
	return evalResult?.result ?? evalResult
}

/**
 * 创建本机执行器。
 * @param {target_t} target - 目标。
 * @returns {targetExecutor_t} 执行器。
 */
function createLocalExecutor(target) {
	const cwd = target.workdir
	const spawnOptions = { no_ansi_terminal_sequences: true, ...cwd ? { cwd: resolveLocalPath(cwd) } : {} }
	/**
	 * 将路径解析为本机绝对路径（相对路径基于目标 workdir）。
	 * @param {string} p - 原始路径。
	 * @returns {string} 绝对路径。
	 */
	const abs = p => path.isAbsolute(p) || p.startsWith('~') || /^[A-Za-z]:[\\/]/.test(p)
		? resolveLocalPath(p)
		: resolveLocalPath(joinWorkdir(cwd, p))
	return {
		/**
		 * 执行 shell 命令（shell 为 null 时用 exec 默认 shell）。
		 * @param {string|null} shell - shell 名。
		 * @param {string} code - 命令。
		 * @returns {Promise<any>} 执行结果。
		 */
		async execShell(shell, code) {
			if (shell) {
				if (!shell_exec_map[shell]) throw new Error(`Unsupported shell: ${shell}`)
				return await shell_exec_map[shell](code, spawnOptions)
			}
			return await exec(code, spawnOptions)
		},
		/**
		 * 执行 JS。
		 * @param {string} code - 代码。
		 * @returns {Promise<any>} EvalResult.result。
		 */
		execJs: async code => unwrapEval(await async_eval(code, {})),
		/**
		 * 读文本文件。
		 * @param {string} p - 路径。
		 * @returns {Promise<string>} 文件内容。
		 */
		readTextFile: async p => await fs.promises.readFile(abs(p), 'utf-8'),
		/**
		 * 读二进制文件。
		 * @param {string} p - 路径。
		 * @returns {Promise<Buffer>} 文件内容。
		 */
		readFileBuffer: async p => await fs.promises.readFile(abs(p)),
		/**
		 * 写文本文件。
		 * @param {string} p - 路径。
		 * @param {string} content - 内容。
		 * @returns {Promise<void>}
		 */
		writeTextFile: async (p, content) => {
			const absPath = abs(p)
			await fs.promises.mkdir(path.dirname(absPath), { recursive: true })
			await fs.promises.writeFile(absPath, content, 'utf-8')
		},
		/**
		 * 列目录。
		 * @param {string} p - 路径。
		 * @returns {Promise<dirEntry_t[]>} 条目列表。
		 */
		listDir: async p => {
			const entries = await fs.promises.readdir(abs(p), { withFileTypes: true })
			return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))
		},
		/**
		 * 查看条目。
		 * @param {string} p - 路径。
		 * @returns {Promise<{isDirectory: boolean, isFile: boolean}|null>} 类型信息（不存在时 null）。
		 */
		statEntry: async p => {
			try {
				const st = await fs.promises.stat(abs(p))
				return { isDirectory: st.isDirectory(), isFile: st.isFile() }
			}
			catch {
				return null
			}
		},
		/**
		 * 判断路径是否存在。
		 * @param {string} p - 路径。
		 * @returns {Promise<boolean>} 是否存在。
		 */
		pathExists: async p => {
			try {
				await fs.promises.access(abs(p))
				return true
			}
			catch {
				return false
			}
		},
		/**
		 * 列根（Windows 盘符 / unix `/`）。
		 * @returns {Promise<string[]>} 根列表。
		 */
		listRoots: async () => {
			if (process.platform === 'win32') {
				const letters = []
				for (let c = 65; c <= 90; c++) {
					const drive = `${String.fromCharCode(c)}:\\`
					if (await fs.promises.access(drive).then(() => true, () => false))
						letters.push(drive)
				}
				return letters
			}
			return ['/']
		},
	}
}

/**
 * 生成远程 fs 操作脚本（在目标机器上由 async_eval 执行）。
 * @param {string} body - 脚本主体（`fs` / `path` 模块已就绪）。
 * @returns {string} 完整脚本。
 */
function remoteFsScript(body) {
	return `const fs = await import('node:fs/promises');\nconst path = await import('node:path');\n${body}`
}

/**
 * 创建远程执行器（经 subfounts 执行器）。
 * @param {string} username - 用户名。
 * @param {target_t} target - 目标（machine > 0）。
 * @returns {targetExecutor_t} 执行器。
 */
function createRemoteExecutor(username, target) {
	const machine = target.machineId
	const base = target.workdir
	/**
	 * 执行远程脚本并解包 EvalResult。
	 * @param {string} body - 脚本主体。
	 * @returns {Promise<any>} result 值。
	 */
	const run = async body => unwrapEval(await executeCodeOnSubfount(username, machine, body))
	/**
	 * 将相对/绝对路径解析为目标机器上的绝对路径并执行脚本。
	 * @param {(p: string) => string} bodyFactory - 以解析后绝对路径表达式为参数生成脚本主体。
	 * @param {string} p - 原始路径。
	 * @returns {Promise<any>} result 值。
	 */
	const withPath = (bodyFactory, p) => run(remoteFsScript(bodyFactory(`path.resolve(${JSON.stringify(base || '.')}, ${JSON.stringify(p)})`)))
	return {
		/**
		 * 执行 shell 命令（shell 为 null 时由目标机器 exec 决定默认）。
		 * @param {string|null} shell - shell 名。
		 * @param {string} code - 命令。
		 * @returns {Promise<any>} 执行结果。
		 */
		execShell: async (shell, code) => await executeShellOnSubfount(username, machine, code, shell, {
			no_ansi_terminal_sequences: true,
			...base ? { cwd: base } : {},
		}),
		/**
		 * 执行 JS。
		 * @param {string} code - 代码。
		 * @returns {Promise<any>} EvalResult.result。
		 */
		execJs: async code => await run(code),
		/**
		 * 读文本文件。
		 * @param {string} p - 路径。
		 * @returns {Promise<string>} 文件内容。
		 */
		readTextFile: async p => await withPath(absExpr => `return await fs.readFile(${absExpr}, 'utf8')`, p),
		/**
		 * 读二进制文件（base64 传输后还原 Buffer）。
		 * @param {string} p - 路径。
		 * @returns {Promise<Buffer>} 文件内容。
		 */
		readFileBuffer: async p => {
			const b64 = await withPath(absExpr => `return (await fs.readFile(${absExpr})).toString('base64')`, p)
			return Buffer.from(b64, 'base64')
		},
		/**
		 * 写文本文件。
		 * @param {string} p - 路径。
		 * @param {string} content - 内容。
		 * @returns {Promise<void>}
		 */
		writeTextFile: async (p, content) => await withPath(absExpr => `await fs.mkdir(path.dirname(${absExpr}), { recursive: true });\nawait fs.writeFile(${absExpr}, ${JSON.stringify(content)}, 'utf8')`, p),
		/**
		 * 列目录。
		 * @param {string} p - 路径。
		 * @returns {Promise<dirEntry_t[]>} 条目列表。
		 */
		listDir: async p => await withPath(absExpr => `const entries = await fs.readdir(${absExpr}, { withFileTypes: true });\nreturn entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))`, p),
		/**
		 * 查看条目。
		 * @param {string} p - 路径。
		 * @returns {Promise<{isDirectory: boolean, isFile: boolean}|null>} 类型信息（不存在时 null）。
		 */
		statEntry: async p => await withPath(absExpr => `try { const st = await fs.stat(${absExpr}); return { isDirectory: st.isDirectory(), isFile: st.isFile() } } catch { return null }`, p),
		/**
		 * 判断路径是否存在。
		 * @param {string} p - 路径。
		 * @returns {Promise<boolean>} 是否存在。
		 */
		pathExists: async p => await withPath(absExpr => `return await fs.access(${absExpr}).then(() => true, () => false)`, p),
		/**
		 * 列根（Windows 盘符 / unix `/`）。
		 * @returns {Promise<string[]>} 根列表。
		 */
		listRoots: async () => await run(remoteFsScript('let roots = [\'/\']\nif (process.platform === \'win32\') {\n\troots = []\n\tfor (let c = 65; c <= 90; c++) {\n\t\tconst drive = String.fromCharCode(c) + \':\\\\\'\n\t\tif (await fs.access(drive).then(() => true, () => false)) roots.push(drive)\n\t}\n}\nreturn roots')),
	}
}

/**
 * 按目标创建执行器。target 可为 resolveTarget 的完整结果，也可只给 {machine, workdir} 原始值（内部归一化）。
 * @param {string} username - 用户名。
 * @param {target_t|{machine?: string, workdir?: string}} target - 目标。
 * @returns {targetExecutor_t} 执行器。
 */
export function createTargetExecutor(username, target) {
	const normalized = target.remote === undefined ? resolveTarget(undefined, target) : target
	return normalized.remote && normalized.machineId > 0 ? createRemoteExecutor(username, { ...normalized, machine: normalized.machineId }) : createLocalExecutor(target)
}

/**
 * 解析标签属性串（machine / workdir / path 等 `k="v"` 形式）。
 * @param {string} [attrs] - 属性串。
 * @returns {Record<string, string>} 属性表。
 */
export function parseTagAttrs(attrs) {
	const result = {}
	for (const m of (attrs || '').matchAll(/([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g))
		result[m[1]] = m[2]
	return result
}

/**
 * 创建基于 GetReply 请求的标签属性 → 执行器解析器（同一目标复用执行器实例）。
 * @param {chatReplyRequest_t} args - GetReply 请求（读 `args.workdir` 默认值与 `args.username`）。
 * @returns {(attrs?: string|Record<string, string>) => targetExecutor_t} 执行器获取函数。
 */
export function createArgsExecutorResolver(args) {
	/** @type {Map<string, targetExecutor_t>} */
	const executors = new Map()
	/**
	 * 按标签属性获取执行器。
	 * @param {string|Record<string, string>} [attrs] - 属性串或属性表。
	 * @returns {targetExecutor_t} 执行器。
	 */
	return attrs => {
		const explicit = typeof attrs === 'string' ? parseTagAttrs(attrs) : attrs || {}
		const target = resolveTarget(args, explicit)
		const key = target.machine + '|' + (target.workdir || '')
		if (!executors.has(key))
			executors.set(key, createTargetExecutor(args.username, target))
		return executors.get(key)
	}
}
