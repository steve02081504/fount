/**
 * code shell 上下文装载：profile（自带/全局/工作区并集）、commands、工作区 AGENTS.md。
 * profile 目录协议（工作区 `.agents/` 与全局 `{userDict}/shells/code/agents/` 同构）：
 * - `<name>.md`：profile，YAML frontmatter（description）+ 正文为该 profile 的 prompt
 * - `modes/<name>.md`：mode 类 profile
 * - `commands/<name>.md`：命令，frontmatter（description、params: { name: { required, default, description } }），正文为模板
 * 合并优先级：工作区 > 全局 > 自带（同名）。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 */
import os from 'node:os'
import path from 'node:path'

import { httpError } from '../../../../../scripts/http_error.mjs'
import { getUserDictionary } from '../../../../../server/auth/index.mjs'
import { parseFrontmatter } from '../../../plugins/file-operations/src/context_files.mjs'
import { createTargetExecutor, joinWorkdir } from '../../../plugins/file-operations/src/target.mjs'

/** 自带 profile（mode）。 */
export const BUILTIN_PROFILES = [
	{
		name: 'plan',
		source: 'builtin',
		description: '',
		content: `\
# Plan 模式
你当前处于 PLAN（规划）模式，这是一个只读的分析与规划环境：
- 只做代码阅读、搜索与分析，输出计划、方案与解释。
- 禁止修改文件：不要使用 <override-file> / <replace-file>。
- 禁止执行有副作用的命令（安装依赖、构建、写入、提交等）；只允许只读命令。
- 给出方案时列出将要修改的文件、步骤与风险，等待用户确认后由用户切换到 build 模式执行。`,
	},
	{
		name: 'build',
		source: 'builtin',
		description: '',
		content: `\
# Build 模式
你当前处于 BUILD（构建）模式，拥有完整操作权限：
- 可以读取、修改、创建文件，执行构建、测试等命令以完成任务。
- 操作时遵循工作区约定（AGENTS.md / profile），谨慎对待不可逆操作（删除、覆写前先确认内容）。`,
	},
]

/**
 * 获取全局 profile 目录（本机 fs）。
 * @param {string} username - 用户名。
 * @returns {string} 目录绝对路径。
 */
export function getGlobalAgentsDir(username) {
	try {
		return path.join(getUserDictionary(username), 'shells', 'code', 'agents')
	}
	catch {
		// 用户词典不可用（如未注册的独立测试环境）时退回空目录，profile 仅剩自带与工作区来源。
		return path.join(os.tmpdir(), 'fount-code-unavailable-agents')
	}
}

/**
 * 去除 markdown 文本的 frontmatter，返回正文。
 * @param {string} text - 文件内容。
 * @returns {string} 正文。
 */
export function stripFrontmatter(text) {
	return text.replace(/^---\r?\n[^]*?\r?\n---\r?\n?/, '')
}

/**
 * profile 条目。
 * @typedef {{name: string, source: 'builtin'|'global'|'workspace', description: string, content: string}} profileEntry_t
 */

/**
 * 从 .agents 风格目录收集 profile（含 modes/ 子目录）。
 * @param {import('../../../plugins/file-operations/src/target.mjs').targetExecutor_t} executor - 执行器。
 * @param {string} dir - .agents 目录。
 * @param {'global'|'workspace'} source - 来源。
 * @param {Map<string, profileEntry_t>} map - 汇总表（后者覆盖同名）。
 * @returns {Promise<void>}
 */
async function scanProfilesDir(executor, dir, source, map) {
	const entries = await executor.listDir(dir).catch(() => [])
	for (const entry of entries.filter(e => e.isFile && e.name.endsWith('.md'))) {
		const content = await executor.readTextFile(dir + '/' + entry.name).catch(() => null)
		if (content == null) continue
		const name = entry.name.replace(/\.md$/i, '')
		const { description } = parseFrontmatter(content)
		map.set(name, { name, source, description: description || '', content: stripFrontmatter(content).trim() })
	}
	const modesDir = entries.find(e => e.isDirectory && e.name === 'modes')
	if (modesDir) {
		const modeEntries = await executor.listDir(dir + '/modes').catch(() => [])
		for (const entry of modeEntries.filter(e => e.isFile && e.name.endsWith('.md'))) {
			const content = await executor.readTextFile(dir + '/modes/' + entry.name).catch(() => null)
			if (content == null) continue
			const name = entry.name.replace(/\.md$/i, '')
			const { description } = parseFrontmatter(content)
			map.set(name, { name, source, description: description || '', content: stripFrontmatter(content).trim() })
		}
	}
}

/**
 * 列出合并后的 profile 列表（工作区 > 全局 > 自带）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @returns {Promise<profileEntry_t[]>} 合并后的 profile 列表。
 */
export async function listProfiles(username, workdir) {
	/** @type {Map<string, profileEntry_t>} */
	const map = new Map()
	for (const builtin of BUILTIN_PROFILES)
		map.set(builtin.name, { ...builtin })
	const localExecutor = createTargetExecutor(username, { machine: 0 })
	await scanProfilesDir(localExecutor, getGlobalAgentsDir(username), 'global', map)
	if (workdir?.path) {
		const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
		await scanProfilesDir(executor, joinWorkdir(workdir.path, '.agents'), 'workspace', map)
	}
	return [...map.values()]
}

/**
 * 按名称解析 profile。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @param {string} name - profile 名。
 * @returns {Promise<profileEntry_t|null>} profile 条目（未找到时 null）。
 */
export async function getProfile(username, workdir, name) {
	const profiles = await listProfiles(username, workdir)
	return profiles.find(p => p.name === name) || null
}

/**
 * 读取工作区根 AGENTS.md（大小写不敏感）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @returns {Promise<{path: string, content: string}|null>} AGENTS.md 内容。
 */
export async function loadWorkspaceAgentsMd(username, workdir) {
	if (!workdir?.path) return null
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const entries = await executor.listDir(workdir.path).catch(() => [])
	const agentsFile = entries.find(e => e.isFile && e.name.toLowerCase() === 'agents.md')
	if (!agentsFile) return null
	const content = await executor.readTextFile(workdir.path + '/' + agentsFile.name).catch(() => null)
	if (content == null) return null
	return { path: workdir.path + '/' + agentsFile.name, content }
}

/**
 * 命令条目。
 * @typedef {{name: string, source: 'global'|'workspace', description: string, params: Record<string, {required?: boolean, default?: string, description?: string}>, template: string}} commandEntry_t
 */

/**
 * 按缩进解析命令 frontmatter 的 params 块。
 * @param {string} frontmatter - frontmatter 正文。
 * @returns {Record<string, {required?: boolean, default?: string, description?: string}>} 参数表。
 */
function parseParamsBlock(frontmatter) {
	/** @type {Record<string, {required?: boolean, default?: string, description?: string}>} */
	const params = {}
	let inParams = false
	let current = null
	for (const rawLine of frontmatter.split(/\r?\n/)) {
		const line = rawLine.replace(/\t/g, '  ')
		if (!line.trim()) continue
		const indent = line.match(/^ */)[0].length
		const kv = line.trim().match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
		if (!kv) continue
		const [, key, rawValue] = kv
		const value = rawValue.trim().replace(/^['"]|['"]$/g, '')
		if (indent === 0) {
			inParams = key === 'params'
			current = null
			continue
		}
		if (!inParams) continue
		if (indent === 2) {
			current = params[key] ??= {}
			if (value) current.default = value
		}
		else if (indent >= 4 && current) 
			if (key === 'required') current.required = value === 'true'
			else if (key === 'default') current.default = value
			else if (key === 'description') current.description = value
		
	}
	return params
}

/**
 * 解析命令文件的 frontmatter（description、params）。
 * @param {string} content - 文件内容。
 * @returns {{description: string, params: Record<string, {required?: boolean, default?: string, description?: string}>}} 解析结果。
 */
function parseCommandFrontmatter(content) {
	const match = content.match(/^---\r?\n([^]*?)\r?\n---\r?\n?/)
	if (!match) return { description: '', params: {} }
	const { description } = parseFrontmatter(content)
	return { description: description || '', params: parseParamsBlock(match[1]) }
}

/**
 * 从 .agents 风格目录收集 commands。
 * @param {import('../../../plugins/file-operations/src/target.mjs').targetExecutor_t} executor - 执行器。
 * @param {string} dir - commands 目录。
 * @param {'global'|'workspace'} source - 来源。
 * @param {Map<string, commandEntry_t>} map - 汇总表（后者覆盖同名）。
 * @returns {Promise<void>}
 */
async function scanCommandsDir(executor, dir, source, map) {
	const entries = await executor.listDir(dir).catch(() => [])
	for (const entry of entries.filter(e => e.isFile && e.name.endsWith('.md'))) {
		const content = await executor.readTextFile(dir + '/' + entry.name).catch(() => null)
		if (content == null) continue
		const name = entry.name.replace(/\.md$/i, '')
		const { description, params } = parseCommandFrontmatter(content)
		map.set(name, { name, source, description, params, template: stripFrontmatter(content).trim() })
	}
}

/**
 * 列出合并后的命令（工作区 > 全局）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @returns {Promise<commandEntry_t[]>} 合并后的命令列表。
 */
export async function listCommands(username, workdir) {
	/** @type {Map<string, commandEntry_t>} */
	const map = new Map()
	const localExecutor = createTargetExecutor(username, { machine: 0 })
	await scanCommandsDir(localExecutor, path.join(getGlobalAgentsDir(username), 'commands'), 'global', map)
	if (workdir?.path) {
		const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
		await scanCommandsDir(executor, joinWorkdir(workdir.path, '.agents/commands'), 'workspace', map)
	}
	return [...map.values()]
}

/**
 * 按名称解析命令。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @param {string} name - 命令名。
 * @returns {Promise<commandEntry_t|null>} 命令条目（未找到时 null）。
 */
export async function getCommand(username, workdir, name) {
	const commands = await listCommands(username, workdir)
	return commands.find(c => c.name === name) || null
}

/**
 * 校验并补全命令参数（required 缺失抛 400；default 补全）。
 * @param {commandEntry_t} command - 命令条目。
 * @param {Record<string, string>} argv - 用户提供的参数。
 * @returns {Record<string, string>} 补全后的参数。
 */
export function resolveCommandArgs(command, argv = {}) {
	/** @type {Record<string, string>} */
	const resolved = {}
	for (const [name, spec] of Object.entries(command.params || {})) {
		if (argv[name] != null && argv[name] !== '') {
			resolved[name] = String(argv[name])
			continue
		}
		if (spec?.default != null && spec.default !== '') {
			resolved[name] = spec.default
			continue
		}
		if (spec?.required)
			throw httpError(400, `命令 ${command.name} 缺少必填参数：${name}`)
	}
	return resolved
}

/**
 * 异步正则替换。
 * @param {string} text - 原文本。
 * @param {RegExp} regexp - 正则（需含 g 标志）。
 * @param {(match: RegExpExecArray) => Promise<string>} replacer - 异步替换器。
 * @returns {Promise<string>} 替换结果。
 */
async function replaceAsync(text, regexp, replacer) {
	const parts = []
	let lastIndex = 0
	for (const match of text.matchAll(regexp)) {
		parts.push(text.slice(lastIndex, match.index))
		parts.push(await replacer(match))
		lastIndex = match.index + match[0].length
	}
	parts.push(text.slice(lastIndex))
	return parts.join('')
}

/**
 * 渲染命令模板：`$argv.name` 参数替换 + `` !`cmd`{:shell} `` 内联 shell + `` ${js} `` 内联 JS。
 * @param {commandEntry_t} command - 命令条目。
 * @param {Record<string, string>} argv - 参数。
 * @param {import('../../../plugins/file-operations/src/target.mjs').targetExecutor_t} executor - 执行器（目标机器）。
 * @returns {Promise<string>} 渲染结果。
 */
export async function renderCommand(command, argv, executor) {
	const { async_eval } = await import('npm:@steve02081504/async-eval')
	let template = command.template
	// 内联 shell：!`cmd`{:shell?} → stdout
	template = await replaceAsync(template, /!`([^`]+)`(?:\{:(\w+)\})?/g, async match => {
		const cmd = match[1]
		const shell = match[2]
		const result = await executor.execShell(shell || null, cmd)
		if (result instanceof Error) throw result
		if (result.code) throw new Error(`命令执行失败（exit ${result.exitCode}）：${cmd}\n${result.stdall || result.stderr || ''}`)
		return String(result.stdout ?? '').trim()
	})
	// 内联 JS：${expr} → 求值结果（argv 可用）
	template = await replaceAsync(template, /\$\{([^]+?)\}/g, async match => {
		const expr = match[1]
		const script = `const argv = ${JSON.stringify(argv)};\nreturn (${expr})`
		const evalResult = await async_eval(script, {})
		if (evalResult.error) throw evalResult.error
		return String(evalResult.result)
	})
	// 参数替换：$argv.name
	template = template.replace(/\$argv\.(\w+)/g, (_m, key) => argv[key] ?? '')
	return template
}

/**
 * 搜索工作区内文件（跳过 node_modules/.git 等，按文件名子串匹配）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}} workdir - 目标工作区。
 * @param {string} query - 查询子串。
 * @param {number} [limit=20] - 结果上限。
 * @returns {Promise<string[]>} 匹配的文件路径（相对工作区）。
 */
export async function searchWorkspaceFiles(username, workdir, query, limit = 20) {
	if (!workdir?.path) return []
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const script = `\
const path = await import('node:path')
const fs = await import('node:fs/promises')
const ROOT = ${JSON.stringify(workdir.path)}
const Q = ${JSON.stringify(query.toLowerCase())}
const LIMIT = ${limit}
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', 'target'])
const out = []
async function walk(dir, depth) {
	if (out.length >= LIMIT || depth > 8) return
	let entries
	try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
	for (const e of entries) {
		if (out.length >= LIMIT) return
		if (e.name.startsWith('.') && e.name !== '.agents') continue
		const full = path.join(dir, e.name)
		if (e.isDirectory()) {
			if (!SKIP.has(e.name)) await walk(full, depth + 1)
		}
		else if (e.name.toLowerCase().includes(Q)) out.push(full)
	}
}
await walk(ROOT, 0)
return out.map(x => x.slice(ROOT.length).replace(/^\\\\/, '').replace(/^\\//, ''))`
	return await executor.execJs(script)
}

/**
 * 读取工作区内文本文件并附带向上上下文（AGENTS.md / .agents/docs 触发文档）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}|undefined} workdir - 目标工作区。
 * @param {string} filePath - 文件路径。
 * @returns {Promise<{content: string, context: string}>} 文件内容与上下文文本。
 */
export async function readFileWithContext(username, workdir, filePath) {
	const executor = createTargetExecutor(username, { machine: workdir?.machine ?? '0', workdir: workdir?.path })
	const content = await executor.readTextFile(filePath)
	const { collectUpwardContext, formatUpwardContext } = await import('../../../plugins/file-operations/src/context_files.mjs')
	const context = await collectUpwardContext(executor, workdir?.path, filePath)
	return { content, context: formatUpwardContext(context) }
}
