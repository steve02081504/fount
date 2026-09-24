/**
 * 【文件】src/cli.mjs — Agent Studio CLI
 * 【职责】`fount run agent_studio <subcommand>` / `fount runas <user> agent_studio <subcommand>`：列出会话、读取会话/生成详情并 dump 完整逐轮 prompt。
 * 【原理】复用生成历史的会话查询（`generation_history.mjs`）与 `generationChain.conversationKey`；默认人类可读文本，`--json` / `--format json` 输出机器可读 JSON；`--out` 写文件。
 *   由 `main.mjs` 的 `ArgumentsHandler` 调用，返回值字符串由 CLI 进程写到 stdout；错误抛出由 IPC 通道传播为非零退出。
 * 【关联】main.mjs、src/endpoints.mjs、generation_history.mjs、server/index.mjs runpart 输出。
 */
import fs from 'node:fs'
import path from 'node:path'

import { buildCacheReport } from './cache_report.mjs'
import { getConversation, getGeneration, listConversations, listGenerations } from './generation_history.mjs'

/** 命令用法文本。 */
const USAGE = `\
用法：
  fount run agent_studio conversations [--char <id>] [--source <src>] [--limit <n>] [--json]
  fount run agent_studio conversation <key> [--json] [--out <path>]
  fount run agent_studio generation <id> [--json] [--out <path>]
  fount run agent_studio dump <key> [--format json|text] [--out <path>]
  fount run agent_studio cache-report <key> [--threshold <0-1>]

说明：
  conversations  列出会话摘要（键、生成数、角色、最近时间）。
  conversation   输出一个会话的生成记录及其逐轮 prompt 请求。
  generation     输出单条生成记录。
  dump           输出完整会话数据（默认 JSON），供 agent 直接解析。
  cache-report   输出会话逐请求提示缓存命中率 JSON（标记压缩轮次），供自动检查脚本解析。
  run 使用最后活跃用户；runas <user> ... 显式指定用户。
`

/**
 * 解析子命令后的选项与位置参数。
 * @param {string[]} args 参数
 * @returns {{ _: string[], flags: Record<string, string | boolean> }} 解析结果
 */
export function parseArgs(args) {
	const flags = {}
	const positional = []
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--json') { flags.json = true; continue }
		if (arg.startsWith('--')) {
			const eq = arg.indexOf('=')
			if (eq !== -1) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue }
			const name = arg.slice(2)
			const next = args[i + 1]
			if (next === undefined || next.startsWith('--')) flags[name] = true
			else { flags[name] = next; i++ }
			continue
		}
		positional.push(arg)
	}
	return { _: positional, flags }
}

/**
 * 取字符串选项。
 * @param {Record<string, string | boolean>} flags 选项
 * @param {string} name 名称
 * @returns {string | undefined} 值
 */
function optionString(flags, name) {
	const value = flags[name]
	return typeof value === 'string' ? value : undefined
}

/**
 * 格式化时间戳。
 * @param {number} [ms] 毫秒时间戳
 * @returns {string} 本地时间字符串
 */
function formatTime(ms) {
	return ms ? new Date(ms).toLocaleString() : '-'
}

/**
 * 把逐轮请求渲染为文本。
 * @param {object} generation 生成记录
 * @returns {string} 文本
 */
function renderRequestRounds(generation) {
	const requests = generation.requests
	if (!requests?.length) {
		if (generation.requestsStripped || generation.requestCount)
			return `    （逐轮 prompt 已过期，原有 ${generation.requestCount ?? '?'} 轮）\n`
		return '    （未采集逐轮 prompt）\n'
	}
	let out = ''
	for (const request of requests) {
		out += `    [轮次 ${request.index}] 模型 ${request.model ?? '-'} · ${formatTime(request.startedAt)}\n`
		out += '      --- system ---\n'
		out += String(request.systemPrompt ?? '').split('\n').map(line => `      ${line}`).join('\n') + '\n'
		out += '      --- messages ---\n'
		for (const message of request.messages ?? [])
			out += `      ${message.role} ${message.name}: ${message.content}\n`
	}
	return out
}

/**
 * 把会话渲染为人类可读文本。
 * @param {{ key: string, generations: object[] }} conversation 会话
 * @returns {string} 文本
 */
export function renderConversationText(conversation) {
	let out = `# 会话 ${conversation.key}（${conversation.generations.length} 条生成）\n\n`
	for (const generation of conversation.generations) {
		out += `## 生成 ${generation.id}\n`
		out += `   来源 ${generation.source ?? '-'} · 角色 ${generation.charname ?? generation.charId ?? '-'} · 模型 ${generation.model ?? '-'} · ${formatTime(generation.startedAt)}\n`
		out += '   回复：\n'
		out += String(generation.response ?? '').split('\n').map(line => `      ${line}`).join('\n') + '\n'
		out += `   请求轮次：\n${renderRequestRounds(generation)}\n`
	}
	return out
}

/**
 * 列出会话摘要为文本。
 * @param {object[]} conversations 会话摘要
 * @returns {string} 文本
 */
export function renderConversationsText(conversations) {
	if (!conversations.length) return '（暂无会话）\n'
	return conversations.map(conversation =>
		`${conversation.key}\t生成 ${conversation.generationCount} 条\t轮次 ${conversation.requestCount}\t角色 ${conversation.charname || conversation.charId || '-'}\t${formatTime(conversation.finishedAt ?? conversation.startedAt)}`
	).join('\n') + '\n'
}

/**
 * 判断是否要求 JSON 输出。
 * @param {Record<string, string | boolean>} flags 选项
 * @returns {boolean} 是否 JSON
 */
function wantsJson(flags) {
	if (flags.json === true) return true
	return optionString(flags, 'format') === 'json'
}

/**
 * 把最终内容写到文件或返回给调用方。
 * @param {string} content 内容
 * @param {string | undefined} outPath 输出路径（相对 cwd）
 * @param {string} cwd 调用方工作目录
 * @param {string} describe 描述（写入文件后回报）
 * @returns {string} 返回给 CLI 的文本
 */
function emit(content, outPath, cwd, describe) {
	if (outPath) {
		const target = path.isAbsolute(outPath) ? outPath : path.resolve(cwd, outPath)
		fs.mkdirSync(path.dirname(target), { recursive: true })
		fs.writeFileSync(target, content)
		return `${describe} 已写入 ${target}\n`
	}
	return content
}

/**
 * 执行 Agent Studio CLI。
 * @param {string} username 用户名（由 run/runas 分发）
 * @param {string[]} args 子命令与参数
 * @param {{ cwd?: string }} [context] 调用上下文
 * @returns {Promise<string>} 供 CLI 写到 stdout 的文本
 */
export async function runStudioCli(username, args, context = {}) {
	if (!username) throw new Error('agent_studio CLI: 缺少用户名')
	const cwd = context.cwd || process.cwd()
	const [subcommand, ...rest] = args
	if (!subcommand || subcommand === 'help' || subcommand === '--help') return USAGE
	const { _, flags } = parseArgs(rest)

	switch (subcommand) {
		case 'conversations': {
			const list = await listConversations(username, {
				charId: optionString(flags, 'char'),
				source: optionString(flags, 'source'),
				limit: optionString(flags, 'limit') ? Number(optionString(flags, 'limit')) : undefined,
			})
			if (wantsJson(flags)) return JSON.stringify(list, null, 2) + '\n'
			return renderConversationsText(list)
		}
		case 'conversation': {
			const key = _[0]
			if (!key) throw new Error('用法：conversation <key>')
			const conversation = await getConversation(username, key)
			if (!conversation) throw new Error(`会话不存在：${key}`)
			const content = wantsJson(flags)
				? JSON.stringify(conversation, null, 2) + '\n'
				: renderConversationText(conversation)
			return emit(content, optionString(flags, 'out'), cwd, `会话 ${key}`)
		}
		case 'generation': {
			const id = _[0]
			if (!id) throw new Error('用法：generation <id>')
			const record = await getGeneration(username, id)
			if (!record) throw new Error(`生成记录不存在：${id}`)
			const content = JSON.stringify(record, null, 2) + '\n'
			return emit(content, optionString(flags, 'out'), cwd, `生成 ${id}`)
		}
		case 'dump': {
			const key = _[0]
			if (!key) throw new Error('用法：dump <key>')
			const conversation = await getConversation(username, key)
			if (!conversation) throw new Error(`会话不存在：${key}`)
			const format = optionString(flags, 'format') ?? 'json'
			const content = format === 'text'
				? renderConversationText(conversation)
				: JSON.stringify(conversation, null, 2) + '\n'
			return emit(content, optionString(flags, 'out'), cwd, `会话 ${key} dump`)
		}
		case 'cache-report': {
			const key = _[0]
			if (!key) throw new Error('用法：cache-report <key>')
			const threshold = optionString(flags, 'threshold') ? Number(optionString(flags, 'threshold')) : 0.729
			const summaries = await listGenerations(username, { conversationId: key, limit: Number.MAX_SAFE_INTEGER })
			const records = []
			for (const summary of summaries) {
				const record = await getGeneration(username, summary.id)
				if (record) records.push(record)
			}
			records.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
			return JSON.stringify(buildCacheReport(records, { conversationId: key, threshold }), null, 2) + '\n'
		}
		default:
			throw new Error(`未知子命令：${subcommand}\n${USAGE}`)
	}
}
