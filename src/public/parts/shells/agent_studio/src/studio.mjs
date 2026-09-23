/**
 * 【文件】src/studio.mjs — agent_studio 业务层
 * 【职责】角色/生成/子代理的可观测查询，以及基准定义与运行的持久化、执行（含 LLM 裁判）。
 * 【原理】生成历史读写走 `generation_history.mjs`；子代理实时状态直接读 `plugins/sub-agent/state.mjs` 内存注册表，
 *   历史运行则由生成记录的 `subAgent.runId` 反推。基准定义/运行存于 shell data（`agent_studio/{benchmarks,benchmarkRuns}.json`）。
 *   运行时手构 `chatReplyRequest_t`：`User*` = 本地操作者，用例输入只作为 `chat_log[]`（作者 uid=user），world/persona 用 chat 内置空实现。
 * 【关联】src/endpoints.mjs、src/benchmark.mjs、generation_history.mjs、plugins/sub-agent/state.mjs、chat builtinParts.mjs。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 */
import { httpError } from '../../../../../scripts/http_error.mjs'
import { localhostLocales } from '../../../../../scripts/i18n/bare.mjs'
import { pickLocalizedSlice } from '../../../../../scripts/locale.mjs'
import { getAllCachedPartDetails, getPartDetails, getPartList, loadAnyPreferredDefaultPart, loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'
import { getRun as getLiveRun, listBatches as listLiveBatches, listRuns as listLiveRuns } from '../../../plugins/sub-agent/state.mjs'
import { BUILTIN_PERSONA, BUILTIN_WORLD } from '../../chat/src/chat/session/builtinParts.mjs'

import { buildJudgePrompt, checkResponse, computeStats, normalizeBenchmark, parseJudgeResponse } from './benchmark.mjs'
import { getGeneration, listConversations, listGenerations } from './generation_history.mjs'

/** shell data 命名空间。 */
const SHELL_NAME = 'agent_studio'

/** 基准运行写入生成记录的 source 标识。 */
export const BENCHMARK_SOURCE = 'shells/agent_studio/benchmark'

/** 单次基准运行最多保留的结果条数（历史记录上限）。 */
const MAX_RUNS = 200

/**
 * 列出全部角色及其缓存详情。
 * @param {string} username 用户
 * @returns {Promise<Array<{ id: string, info: object | null, supportedInterfaces: string[] }>>} 角色列表
 */
export async function listChars(username) {
	const names = getPartList(username, 'chars')
	const { cachedDetails } = await getAllCachedPartDetails(username, 'chars')
	return names.map(id => ({
		id,
		info: cachedDetails[id]?.info ?? null,
		supportedInterfaces: cachedDetails[id]?.supportedInterfaces ?? [],
	}))
}

/**
 * 汇总某角色概览：基本信息 + 最近生成 + 子代理运行/批次。
 * @param {string} username 用户
 * @param {string} charId 角色 id
 * @param {{ limit?: number }} [options] 选项
 * @returns {Promise<object>} 概览
 */
export async function getCharOverview(username, charId, { limit = 50 } = {}) {
	if (!charId) throw httpError(400, 'charId is required')
	const details = await getPartDetails(username, 'chars/' + charId)
	const conversations = await listConversations(username, { charId, limit })
	const { runs, batches } = await listSubAgents(username, { charId })
	return {
		char: { id: charId, ...details.info },
		supportedInterfaces: details.supportedInterfaces,
		conversations,
		subAgents: runs,
		batches,
	}
}

/**
 * 由历史记录 + 实时注册表推导子代理运行与批次。
 * @param {string} username 用户
 * @param {{ charId?: string, chatId?: string } | string} filter 过滤条件（字符串视为 charId）
 * @returns {Promise<{ runs: object[], batches: object[] }>} 运行与批次
 */
export async function listSubAgents(username, filter = {}) {
	const { charId, chatId } = typeof filter === 'string' ? { charId: filter } : filter
	if (!charId && !chatId) throw httpError(400, 'charId or chatId is required')
	const records = await listGenerations(username, {
		...charId ? { charId } : {},
		...chatId ? { chatId } : {},
		limit: 1000,
	})
	let liveRuns = listLiveRuns(charId ? { username, charId } : { username })
	if (chatId) liveRuns = liveRuns.filter(run => run.chat_name === chatId)
	const batches = charId ? listLiveBatches(username, charId) : []
	return summarizeSubAgentRuns(records, liveRuns, batches)
}

/**
 * 读取单次子代理运行的完整状态与内部对话（实时注册表优先，否则回落落盘记录）。
 * @param {string} username 用户
 * @param {string} runId 运行 id
 * @returns {Promise<object>} 运行详情
 */
export async function getSubAgentRun(username, runId) {
	if (!runId) throw httpError(400, 'runId is required')
	const candidate = getLiveRun(runId)
	const live = candidate?.username === username ? candidate : null
	const summaries = await listGenerations(username, { runId, limit: 10 })
	const record = summaries[0] ? await getGeneration(username, summaries[0].id) : null
	if (!live && !record) throw httpError(404, `subagent run not found: ${runId}`)
	return {
		runId,
		charId: live?.charId ?? record?.charId ?? null,
		charname: record?.charname ?? null,
		chatId: live?.chat_name ?? record?.chatId ?? null,
		batchId: live?.batchId ?? record?.subAgent?.batchId ?? null,
		parentRunId: live?.parentRunId ?? record?.subAgent?.parentRunId ?? null,
		parentId: record?.parentId ?? null,
		state: live?.state ?? record?.metadata?.status ?? (record?.error ? 'failed' : 'done'),
		rounds: live?.rounds ?? record?.metadata?.rounds ?? 0,
		roundLimit: live?.roundLimit ?? null,
		depth: live?.depth ?? record?.subAgent?.depth ?? 0,
		isAsync: live?.isAsync ?? record?.subAgent?.isAsync ?? false,
		task: live?.task ?? record?.metadata?.task ?? null,
		startedAt: live?.startedAt ?? record?.startedAt ?? null,
		finishedAt: live?.finishedAt ?? record?.finishedAt ?? null,
		error: record?.error?.message ?? live?.error?.message ?? null,
		conversation: live?.conversation ? live.conversation.map(entry => ({
			id: entry.id, role: entry.role, name: entry.name, time_stamp: entry.time_stamp,
			content: entry.content, content_for_show: entry.content_for_show,
		})) : record?.conversation ?? [],
		canSend: typeof live?.childArgs?.AddChatLogEntry === 'function',
	}
}

/**
 * 向仍在执行的子代理追加用户消息（运行上下文只驻留到结束/服务器重启）。
 * @param {string} username 用户
 * @param {string} runId 运行 id
 * @param {string} content 消息文本
 * @returns {Promise<object>} 追加的条目
 */
export async function sendSubAgentMessage(username, runId, content) {
	const run = getLiveRun(runId)
	if (!run || run.username !== username) throw httpError(404, 'subagent run not found')
	if (typeof run.childArgs?.AddChatLogEntry !== 'function')
		throw httpError(409, 'subagent is no longer accepting messages')
	if (typeof content !== 'string' || !content.trim() || content.length > 20000)
		throw httpError(400, 'message must contain 1-20000 characters')
	return run.childArgs.AddChatLogEntry({ role: 'user', name: username, uid: run.childArgs.UserUid, content, time_stamp: new Date() })
}

/**
 * 纯聚合：把生成记录摘要与实时运行/批次合并为运行视图（可单测，无 I/O）。
 * @param {object[]} [records] 生成记录摘要
 * @param {object[]} [liveRuns] 实时运行对象
 * @param {object[]} [liveBatches] 实时批次对象
 * @returns {{ runs: object[], batches: object[] }} 运行与批次
 */
export function summarizeSubAgentRuns(records = [], liveRuns = [], liveBatches = []) {
	/** @type {Map<string, object>} */
	const runsById = new Map()
	for (const record of records || []) {
		const subAgent = record?.subAgent
		if (!subAgent?.runId) continue
		const startedAt = record.startedAt ?? null
		const finishedAt = record.finishedAt ?? null
		const entry = runsById.get(subAgent.runId) ?? {
			runId: subAgent.runId,
			task: record.task ?? null,
			parentRunId: subAgent.parentRunId ?? null,
			batchId: subAgent.batchId ?? null,
			generationIds: [],
			startedAt,
			finishedAt,
			hasError: false,
		}
		entry.generationIds.push(record.id)
		if (startedAt != null) entry.startedAt = Math.min(entry.startedAt ?? startedAt, startedAt)
		if (finishedAt != null) entry.finishedAt = Math.max(entry.finishedAt ?? finishedAt, finishedAt)
		entry.hasError ||= !!record.hasError
		runsById.set(subAgent.runId, entry)
	}
	for (const live of liveRuns || []) {
		if (!live?.runId) continue
		const entry = runsById.get(live.runId) ?? {
			runId: live.runId,
			parentRunId: live.parentRunId ?? null,
			batchId: live.batchId ?? null,
			generationIds: [],
			startedAt: live.startedAt ?? live.createdAt ?? null,
			finishedAt: live.finishedAt ?? null,
			hasError: !!live.error,
		}
		entry.live = {
			state: live.state,
			rounds: live.rounds ?? 0,
			roundLimit: live.roundLimit ?? null,
			depth: live.depth ?? 0,
			isAsync: !!live.isAsync,
			deadline: live.deadline ?? null,
		}
		entry.task = live.task
		runsById.set(live.runId, entry)
	}
	const runs = [...runsById.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))

	/** @type {Map<string, object>} */
	const batchesById = new Map()
	for (const batch of liveBatches || []) {
		if (!batch?.batchId) continue
		batchesById.set(batch.batchId, { ...batch, runIds: batchesById.get(batch.batchId)?.runIds ?? [] })
	}
	for (const run of runs) {
		if (!run.batchId) continue
		const batch = batchesById.get(run.batchId) ?? { batchId: run.batchId, runIds: [] }
		batch.runIds.push(run.runId)
		batchesById.set(run.batchId, batch)
	}
	return { runs, batches: [...batchesById.values()] }
}

/**
 * 读取基准定义存储。
 * @param {string} username 用户
 * @returns {{ benchmarks: object[] }} 存储对象（内存引用）
 */
function loadBenchmarkStore(username) {
	const data = loadShellData(username, SHELL_NAME, 'benchmarks')
	data.benchmarks ??= []
	return data
}

/**
 * 读取基准运行存储。
 * @param {string} username 用户
 * @returns {{ runs: object[] }} 存储对象（内存引用）
 */
function loadRunStore(username) {
	const data = loadShellData(username, SHELL_NAME, 'benchmarkRuns')
	data.runs ??= []
	return data
}

/**
 * 列出全部基准定义（附用例数）。
 * @param {string} username 用户
 * @returns {object[]} 基准列表
 */
export function listBenchmarks(username) {
	return loadBenchmarkStore(username).benchmarks.map(benchmark => ({
		...benchmark,
		caseCount: benchmark.cases?.length ?? 0,
	}))
}

/**
 * 读取单个基准定义。
 * @param {string} username 用户
 * @param {string} id 基准 id
 * @returns {object} 基准
 */
export function getBenchmark(username, id) {
	const benchmark = loadBenchmarkStore(username).benchmarks.find(candidate => candidate.id === id)
	if (!benchmark) throw httpError(404, `benchmark not found: ${id}`)
	return benchmark
}

/**
 * 创建基准定义。
 * @param {string} username 用户
 * @param {object} input 基准字段
 * @returns {object} 已落盘的基准
 */
export function createBenchmark(username, input) {
	const store = loadBenchmarkStore(username)
	const benchmark = normalizeBenchmark(input)
	benchmark.id ||= crypto.randomUUID()
	store.benchmarks.push(benchmark)
	saveShellData(username, SHELL_NAME, 'benchmarks')
	return benchmark
}

/**
 * 更新基准定义（浅合并后重新归一化）。
 * @param {string} username 用户
 * @param {string} id 基准 id
 * @param {object} patch 补丁
 * @returns {object} 更新后的基准
 */
export function updateBenchmark(username, id, patch = {}) {
	const store = loadBenchmarkStore(username)
	const index = store.benchmarks.findIndex(candidate => candidate.id === id)
	if (index === -1) throw httpError(404, `benchmark not found: ${id}`)
	const merged = normalizeBenchmark({ ...store.benchmarks[index], ...patch, id })
	store.benchmarks[index] = merged
	saveShellData(username, SHELL_NAME, 'benchmarks')
	return merged
}

/**
 * 删除基准定义。
 * @param {string} username 用户
 * @param {string} id 基准 id
 * @returns {object} 删除的基准
 */
export function deleteBenchmark(username, id) {
	const store = loadBenchmarkStore(username)
	const index = store.benchmarks.findIndex(candidate => candidate.id === id)
	if (index === -1) throw httpError(404, `benchmark not found: ${id}`)
	const [removed] = store.benchmarks.splice(index, 1)
	saveShellData(username, SHELL_NAME, 'benchmarks')
	return removed
}

/**
 * 列出基准运行摘要（按开始时间倒序）。
 * @param {string} username 用户
 * @param {{ benchmarkId?: string, charId?: string }} [filter] 过滤
 * @returns {object[]} 运行摘要
 */
export function listBenchmarkRuns(username, filter = {}) {
	return loadRunStore(username).runs
		.filter(run => !filter.benchmarkId || run.benchmarkId === filter.benchmarkId)
		.filter(run => !filter.charId || run.charId === filter.charId)
		.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
		.map(run => ({
			id: run.id,
			benchmarkId: run.benchmarkId,
			charId: run.charId,
			config: run.config,
			stats: run.stats,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
		}))
}

/**
 * 读取单次基准运行完整结果。
 * @param {string} username 用户
 * @param {string} id 运行 id
 * @returns {object} 运行
 */
export function getBenchmarkRun(username, id) {
	const run = loadRunStore(username).runs.find(candidate => candidate.id === id)
	if (!run) throw httpError(404, `benchmark run not found: ${id}`)
	return run
}

/**
 * 运行一次基准：逐用例生成、记录、可选用裁判评分，最后落盘。
 * @param {string} username 用户
 * @param {string} benchmarkId 基准 id
 * @param {{ charId: string, aiSource?: string, judgeAiSource?: string, model?: string }} config 运行配置
 * @returns {Promise<object>} 运行结果
 */
export async function runBenchmark(username, benchmarkId, config = {}) {
	const benchmark = getBenchmark(username, benchmarkId)
	const charId = config.charId
	if (!charId) throw httpError(400, 'charId is required to run a benchmark')
	const char = await loadPart(username, 'chars/' + charId)
	if (!char?.interfaces?.chat?.GetReply)
		throw httpError(400, `char "${charId}" does not support chat.GetReply`)
	const aiSource = config.aiSource ? await loadPart(username, 'serviceSources/AI/' + config.aiSource) : undefined
	const needsJudge = benchmark.cases.some(caseItem => caseItem.criteria || (!caseItem.check && caseItem.expected !== undefined))
	const judgeSource = needsJudge ? await resolveJudgeSource(username, config.judgeAiSource) : null
	if (needsJudge && !judgeSource) throw httpError(400, 'judge AI source is required for criteria-based cases')
	const charInfo = pickLocalizedSlice(char.info, localhostLocales) || {}
	/** @type {object} */
	const run = {
		id: crypto.randomUUID(),
		benchmarkId,
		charId,
		config: { ...config },
		results: [],
		stats: {},
		startedAt: Date.now(),
		finishedAt: null,
	}
	for (const caseItem of benchmark.cases)
		run.results.push(await runBenchmarkCase({ username, benchmark, caseItem, char, charInfo, run, aiSource, judgeSource }))
	run.stats = computeStats(run.results, benchmark.cases)
	run.finishedAt = Date.now()
	const store = loadRunStore(username)
	store.runs.unshift(run)
	if (store.runs.length > MAX_RUNS) store.runs.length = MAX_RUNS
	saveShellData(username, SHELL_NAME, 'benchmarkRuns')
	return run
}

/**
 * 执行单个基准用例并记录生成。
 * @param {object} params 参数
 * @param {string} params.username 用户
 * @param {object} params.benchmark 基准
 * @param {object} params.caseItem 用例
 * @param {object} params.char 角色实例
 * @param {object} params.charInfo 本地化角色信息
 * @param {object} params.run 运行
 * @param {object} [params.aiSource] 请求级 AI 源实例
 * @param {object | null} [params.judgeSource] 裁判 AI 源实例
 * @returns {Promise<object>} 结果条目
 */
async function runBenchmarkCase({ username, benchmark, caseItem, char, charInfo, run, aiSource, judgeSource }) {
	const generationId = crypto.randomUUID()
	const request = buildBenchmarkRequest({ username, charId: run.charId, benchmark, caseItem, char, charInfo, run, aiSource, generationId })
	// 生成记录由角色模板主动调用 Agent Studio API 写入；此处只负责触发并关联结果
	const reply = await char.interfaces.chat.GetReply(request)
	const response = String(reply?.content ?? '')
	/** @type {{ caseId: string, generationId: string, response: string, judge?: object }} */
	const result = { caseId: caseItem.id, generationId, response }
	const program = checkResponse(caseItem, response)
	if (program) result.program = { score: program.score, reason: program.reason, ...program.response !== response ? { transformed: program.response } : {} }
	if (judgeSource && (caseItem.criteria || (!caseItem.check && caseItem.expected !== undefined)))
		if (program?.score === 0) result.judge = { score: 0, reason: 'program check failed; judge skipped', model: null }
		else result.judge = await judgeBenchmarkCase({ judgeSource, caseItem, response: program?.response ?? response, originalResponse: program?.response !== response ? response : undefined })

	return result
}

/**
 * 解析裁判 AI 源：显式名称优先，否则取首选默认 AI 源。
 * @param {string} username 用户
 * @param {string} [name] AI 源名
 * @returns {Promise<object | null>} AI 源实例或 null
 */
async function resolveJudgeSource(username, name) {
	try {
		if (name) return await loadPart(username, 'serviceSources/AI/' + name)
		return await loadAnyPreferredDefaultPart(username, 'serviceSources/AI') ?? null
	}
	catch (error) {
		console.error('agent_studio: failed to load judge AI source', error)
		return null
	}
}

/**
 * 调用裁判 AI 源给一条回复打分。
 * @param {object} params 参数
 * @param {object} params.judgeSource 裁判 AI 源实例
 * @param {object} params.caseItem 用例
 * @param {string} params.response 待评分回复
 * @param {string} [params.originalResponse] 程序反转前的原文
 * @returns {Promise<{ score: number | null, reason: string, model: string | null }>} 评分
 */
async function judgeBenchmarkCase({ judgeSource, caseItem, response, originalResponse }) {
	const prompt = buildJudgePrompt({ case: caseItem, response, originalResponse })
	const text = await judgeSource.Call(prompt)
	const { score, reason } = parseJudgeResponse(text)
	return { score, reason, model: judgeSource.info?.provider ?? null }
}

/**
 * 构造基准用例的 chatReplyRequest（身份规则：User* = 本地操作者；用例输入仅作 chat_log，uid=user）。
 * @param {object} params 参数
 * @param {string} params.username 用户
 * @param {string} params.charId 角色 id
 * @param {object} params.benchmark 基准
 * @param {object} params.caseItem 用例
 * @param {object} params.char 角色实例
 * @param {object} params.charInfo 本地化角色信息
 * @param {object} params.run 运行
 * @param {object} [params.aiSource] 请求级 AI 源实例
 * @param {string} [params.generationId] 预分配的生成 id（供基准结果关联；实际记录由角色主动写入）
 * @returns {chatReplyRequest_t} 请求
 */
export function buildBenchmarkRequest({ username, charId, benchmark, caseItem, char, charInfo, run, aiSource, generationId }) {
	const now = new Date()
	const entry = {
		name: username,
		uid: 'user',
		role: 'user',
		content: caseItem.input,
		time_stamp: now,
		files: [],
		extension: { agent_studio: { benchmarkId: benchmark.id, caseId: caseItem.id, runId: run.id } },
	}
	const supported_functions = {
		markdown: true,
		mathjax: false,
		html: false,
		unsafe_html: false,
		files: false,
		add_message: false,
		fount_i18nkeys: false,
		fount_assets: false,
		fount_themes: false,
	}
	return {
		supported_functions,
		chat_name: 'agent_studio:benchmark:' + run.id,
		chat_id: 'benchmark:' + run.id,
		char_id: charId,
		username,
		Charname: charInfo.name || charId,
		CharUid: 'char',
		UserCharname: username,
		UserUid: 'user',
		locales: localhostLocales,
		time: now,
		world: BUILTIN_WORLD,
		user: BUILTIN_PERSONA,
		char,
		other_chars: {},
		plugins: {},
		chat_log: [entry],
		timelines: [entry],
		chat_summary: '',
		chat_scoped_char_memory: {},
		extension: {
			agent_studio: { benchmarkId: benchmark.id, runId: run.id },
			...generationId ? { generationId } : {},
			agentStudio: {
				source: BENCHMARK_SOURCE,
				metadata: { benchmarkId: benchmark.id, caseId: caseItem.id, runId: run.id },
			},
		},
		ai_source: aiSource,
		/** @returns {Promise<null>} 基准请求不追加消息 */
		AddChatLogEntry: async () => null,
		/** @returns {Promise<object>} 原样返回请求自身 */
		Update: async function update() { return this },
	}
}
