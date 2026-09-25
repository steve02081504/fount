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
import { parseFrontmatter, collectUpwardContext, formatUpwardContext } from '../../../plugins/file-operations/src/context_files.mjs'
import { createTargetExecutor, joinWorkdir } from '../../../plugins/file-operations/src/target.mjs'

/** 默认全局工作习惯，注入自带 plan / build 模式 prompt。 */
const DEFAULT_GLOBAL_HABITS = `\
# 默认工作习惯

- 别为了好看乱换行：commit 信息、代码、issue、文档等任何地方都按语义/语法换行，不按列宽硬折行；一段话就放一行。
- 代码与测试是唯一真相：以源码为准，不盲信注释、过期文档或旧结论。
- 不擅自扩大任务范围；但遇见好修且顺手的无关小错误顺手一修。
- 每次流程走完后，总结沉淀可复用且普适的工具/经验到项目的测试框架/脚本库/agents.md，让未来的工作更顺畅。不用为了总结而总结，没有就跳过。
- 维护 agents.md 时只保留重要结论、指引、工具介绍：重要但不常用 → 在附近 \`docs/\` 新建文件并在 agents.md 留一行链接；调研过程、调查日记、一次性任务笔记 → 删除，不归档。
- 使用 gh 等工具时若遇见 TLS handshake timeout，加一个 while 循环，反复重试直到成功。
- 永远不要撤销你不知道的修改，那可能是别的 agent 正在处理的内容。
- 使用的工具（如依赖包、运行时如 deno/node）有问题时不应 workaround，而是发送 issue，随后向用户表明情况并等待其拿主意。
  issue 流程：用 gh 检查是否有已知 issue，若没有则向对应包发送英文 issue；issue 创建后在 issue 下留言记录 commit 影响、修复后需要改的内容，方便人类在问题关闭时知道要做什么。
  - 工具崩溃/panic/segfault：不要反复重试（最多再试一次）、不要 workaround，直接按上述 issue 流程发 issue；发完 issue 就继续其他任务或宣告完成，别内耗在环境问题上。
- 除非必要，否则不要不经询问进行环境重建、依赖重装等重型操作，避免无意义资源（包括但不限于时间、CPU、网络带宽）浪费。
- 命名用可读标识符（\`context\` 而非 \`ctx\`）；不要把里程碑/计划编号（\`M1\`/\`G4\`…）写进源码、测试、fixture、注释等处，只留在设计/评审文档。
- 不稳定测试（flaky）是 bug，必须定位并修复，不能靠重试/跳过/加 sleep 掩盖；唯一可接受的理由是软件真正无法控制的原因（如远端服务宕机），且要写明——"它就是 flaky" 不构成理由。
- 在修复有具体报错日志的问题前，先追加相关测试并将测试跑通，确保复现错误后再正式开始修复。处理 review 意见、功能追加和改动不用管这个，只在你觉得要加测试时加。
- 用 subagent 时：它不继承父推理，交接要带全任务、路径、约束、已知结论与期望产出；探索仓库时只让它总结并给出结论，不要原样摘抄复述代码——需要批量读代码就用 shell 脚本。
`

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
- 禁止修改文件。
- 禁止执行有副作用的命令（安装依赖、构建、写入、提交等）；只允许只读命令。
- 给出方案时列出将要修改的文件、步骤与风险，等待用户确认后由用户切换到 build 模式执行。

${DEFAULT_GLOBAL_HABITS}`,
	},
	{
		name: 'build',
		source: 'builtin',
		description: '',
		content: `\
# Build 模式
你当前处于 BUILD（构建）模式，拥有完整操作权限：
- 可以读取、修改、创建文件，执行构建、测试等命令以完成任务。
- 操作时遵循工作区约定（AGENTS.md / profile），谨慎对待不可逆操作（删除、覆写前先确认内容）。

${DEFAULT_GLOBAL_HABITS}`,
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
 * 收集单个目录下的 profile markdown 条目（.md 筛选 + 读取 + frontmatter 解析写入汇总表）。
 * @param {import('../../../plugins/file-operations/src/target.mjs').targetExecutor_t} executor - 执行器。
 * @param {string} dir - profile 目录（根或 modes/）。
 * @param {'global'|'workspace'} source - 来源。
 * @param {Map<string, profileEntry_t>} map - 汇总表（后者覆盖同名）。
 * @returns {Promise<Array<{name: string, isDirectory: boolean, isFile: boolean}>>} 目录条目（供 modes 子目录探测）。
 */
async function collectProfileEntries(executor, dir, source, map) {
	const entries = await executor.listDir(dir).catch(() => [])
	for (const entry of entries.filter(e => e.isFile && e.name.endsWith('.md'))) {
		const content = await executor.readTextFile(dir + '/' + entry.name).catch(() => null)
		if (content == null) continue
		const name = entry.name.replace(/\.md$/i, '')
		const { description } = parseFrontmatter(content)
		map.set(name, { name, source, description: description || '', content: stripFrontmatter(content).trim() })
	}
	return entries
}

/**
 * 从 .agents 风格目录收集 profile（含 modes/ 子目录）。
 * @param {import('../../../plugins/file-operations/src/target.mjs').targetExecutor_t} executor - 执行器。
 * @param {string} dir - .agents 目录。
 * @param {'global'|'workspace'} source - 来源。
 * @param {Map<string, profileEntry_t>} map - 汇总表（后者覆盖同名）。
 * @returns {Promise<void>}
 */
async function scanProfilesDir(executor, dir, source, map) {
	const entries = await collectProfileEntries(executor, dir, source, map)
	const modesDir = entries.find(e => e.isDirectory && e.name === 'modes')
	if (modesDir) await collectProfileEntries(executor, dir + '/modes', source, map)
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
	return (await listProfiles(username, workdir)).find(profile => profile.name === name) || null
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
	return (await listCommands(username, workdir)).find(command => command.name === name) || null
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
		if (result.code) throw new Error(`命令执行失败（exit ${result.code}）：${cmd}\n${result.stdall || result.stderr || ''}`)
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
	return await executor.execJs(async (root, q, limit) => {
		const path = await import('node:path')
		const fs = await import('node:fs/promises')
		const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', 'target'])
		const out = []
		/**
		 * 递归遍历目录，收集文件名含 q 的文件。
		 * @param {string} dir - 当前目录。
		 * @param {number} depth - 当前深度。
		 * @returns {Promise<void>}
		 */
		async function walk(dir, depth) {
			if (out.length >= limit || depth > 8) return
			let entries
			try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
			for (const e of entries) {
				if (out.length >= limit) return
				if (e.name.startsWith('.') && e.name !== '.agents') continue
				const full = path.join(dir, e.name)
				if (e.isDirectory()) {
					if (!SKIP.has(e.name)) await walk(full, depth + 1)
				}
				else if (e.name.toLowerCase().includes(q)) out.push(full)
			}
		}
		await walk(root, 0)
		return out.map(x => x.slice(root.length).replace(/^\\/, '').replace(/^\//, ''))
	}, workdir.path, query.toLowerCase(), limit)
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
	const context = await collectUpwardContext(executor, workdir?.path, filePath)
	return { content, context: formatUpwardContext(context) }
}
