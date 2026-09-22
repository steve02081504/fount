/**
 * 【文件】src/public/parts/plugins/sub-agent/state.mjs
 * 【职责】sub-agent 插件的纯内存状态与纯决策逻辑：批次注册表、运行注册表，以及插件集解析、层级轮次传播、限额判定。
 * 【原理】本模块刻意不 import `src/server/**`，只依赖全局 `AbortController` 与 `crypto`，因此可在 `test/pure` 中零 I/O 直接测试。
 *   运行以 `runId` 为键；父链经 `run.parentRunId -> runId` 串起，`propagateRoundsToAncestors` 沿链累加轮次，`isRunOverLimit` 沿链判定——任一祖先超限则当前运行也须摘要。
 *   活跃频道与待注入通知队列已迁至通用 `plugins/async-task/registry.mjs`，本模块不再持有。
 * 【数据结构】batch_t / run_t。
 * 【关联】runtime.mjs 负责真正的生成与 I/O；handler.mjs 解析标签后调用；prompt.mjs 读取轮次；测试 test/pure/state.test.mjs。
 */

/** 未显式指定插件集时的默认工具集（`context-compress` 缺失时由 runtime 容错跳过）。 */
export const DEFAULT_SUBAGENT_PLUGINS = ['code-execution', 'file-operations', 'sub-agent', 'context-compress', 'async-task']

/** 任何子代理运行都必须包含的插件（嵌套运行与轮次统计依赖 `sub-agent`，任务登记与等待依赖 `async-task`）。 */
export const FORCED_SUBAGENT_PLUGINS = ['sub-agent', 'async-task']

/** 永远不得出现在子代理插件集中的插件（避免把宿主聊天层重新拉进来）。 */
export const EXCLUDED_SUBAGENT_PLUGINS = new Set(['fount_chat'])

/** 插件配置默认值：最大子代理深度、父代档案保留消息条数。 */
export const DEFAULT_SUBAGENT_CONFIG = {
	maxDepth: 2,
	archiveTail: 50,
}

/** 当前插件配置（由 main.mjs 的 interfaces.config 读写）。 @type {typeof DEFAULT_SUBAGENT_CONFIG} */
let pluginConfig = { ...DEFAULT_SUBAGENT_CONFIG }

/**
 * 读取当前插件配置。
 * @returns {typeof DEFAULT_SUBAGENT_CONFIG} 配置副本
 */
export function getSubAgentConfig() {
	return { ...pluginConfig }
}

/**
 * 合并写入插件配置。
 * @param {object} data 配置补丁
 * @returns {typeof DEFAULT_SUBAGENT_CONFIG} 更新后的配置
 */
export function setSubAgentConfig(data) {
	pluginConfig = { ...DEFAULT_SUBAGENT_CONFIG, ...data }
	return pluginConfig
}

/**
 * @typedef {object} subAgentBatch_t
 * @property {string} batchId 批次 id
 * @property {string} username 所属用户
 * @property {string} charId 所属角色
 * @property {string} commonContext 批次共享上下文文本（可为空串）
 * @property {string[] | null} defaultPlugins 批次级默认插件列表（完全替换默认，不做并集）
 * @property {number | null} defaultRoundLimit 批次级默认轮次上限
 * @property {number | null} defaultTimeLimitMs 批次级默认时间上限（毫秒）
 * @property {string | null} defaultAiSource 批次级默认 AI 源名
 * @property {number} createdAt
 */

/**
 * @typedef {object} subAgentRun_t
 * @property {string} runId 运行 id
 * @property {string} backgroundId 后台 id（异步运行时返回给父代；与 runId 相同）
 * @property {string | null} parentRunId 父运行 id
 * @property {string | null} batchId 批次 id
 * @property {number} depth 子代理深度（根生成为 0）
 * @property {string} username 用户
 * @property {string} charId 角色 id
 * @property {string} chat_name 派生该运行的频道名
 * @property {string | null} parentGenerationId 父代生成 id
 * @property {number} roundLimit 轮次上限
 * @property {number} timeLimitMs 时间上限
 * @property {number} deadline 绝对截止时间戳
 * @property {number} rounds 已消费轮次（含祖先传播）
 * @property {string} state 状态机取值
 * @property {boolean} terminateRequested 是否请求终止
 * @property {AbortController} controller 运行中断控制器
 * @property {object | null} aiSource 解析后的 AI 源
 * @property {object} plugins 已加载插件表（name -> part）
 * @property {string[]} pluginNames 解析后的插件名列表
 * @property {string | null} archivePath 父代档案临时文件路径
 * @property {number} archiveTail 档案保留的消息条数
 * @property {object[]} conversation 子代理自己的对话（含开场 system 条目）
 * @property {object | null} result 生成结果容器
 * @property {string | null} finalText 最终结果文本
 * @property {string | null} summaryReason 触发摘要的原因
 * @property {object | null} error 失败信息
 * @property {boolean} isAsync 是否异步运行
 * @property {number} createdAt 创建时间
 * @property {number} startedAt 开始时间
 * @property {number} finishedAt 结束时间
 */

/** 批次注册表。 @type {Map<string, subAgentBatch_t>} */
const batches = new Map()

/** 运行注册表（仅内存）。 @type {Map<string, subAgentRun_t>} */
const runs = new Map()

/** 兜底 TTL：异常路径漏删的终态运行与无运行引用的批次按此时长淘汰。 */
const STATE_TTL_MS = 2 * 60 * 60 * 1000

/**
 * 解析插件集声明（`plugins="a,b,c"` 或名称数组）。
 * @param {string | string[] | null | undefined} value 原始声明
 * @returns {string[]} 去重后的插件名列表
 */
export function parsePluginListAttr(value) {
	if (Array.isArray(value)) return value.map(name => String(name ?? '').trim()).filter(Boolean)
	if (typeof value === 'string') return value.split(',').map(name => name.trim()).filter(Boolean)
	return []
}

/**
 * 把显式声明或默认集解析为最终插件列表。
 *
 * 规则（无继承）：显式列表**完全替换**默认列表，绝不与父代插件并集；永远剔除 `fount_chat` 与重复项；永远强制包含 `sub-agent` 与 `async-task`。
 * @param {string | string[] | null | undefined} explicit 显式插件列表（`run-subagent` 或批次级默认）
 * @returns {string[]} 最终插件名列表
 */
export function resolvePluginList(explicit) {
	const declared = parsePluginListAttr(explicit)
	const source = declared.length ? declared : DEFAULT_SUBAGENT_PLUGINS
	const resolved = []
	for (const name of source)
		if (name && !EXCLUDED_SUBAGENT_PLUGINS.has(name) && !resolved.includes(name))
			resolved.push(name)
	for (const name of FORCED_SUBAGENT_PLUGINS)
		if (!resolved.includes(name)) resolved.push(name)
	return resolved
}

/**
 * 创建批次。
 * @param {object} batch 批次字段
 * @returns {subAgentBatch_t} 落库后的批次
 */
export function createBatch(batch) {
	/** @type {subAgentBatch_t} */
	const record = {
		batchId: batch.batchId,
		username: batch.username,
		charId: batch.charId,
		commonContext: batch.commonContext ?? '',
		defaultPlugins: batch.defaultPlugins ?? null,
		defaultRoundLimit: batch.defaultRoundLimit ?? null,
		defaultTimeLimitMs: batch.defaultTimeLimitMs ?? null,
		defaultAiSource: batch.defaultAiSource ?? null,
		createdAt: batch.createdAt ?? Date.now(),
	}
	batches.set(record.batchId, record)
	return record
}

/**
 * @param {string} batchId 批次 id
 * @returns {subAgentBatch_t | undefined} 批次
 */
export function getBatch(batchId) {
	return batches.get(batchId)
}

/**
 * 列出某用户/角色的批次。
 * @param {string} username 用户
 * @param {string} charId 角色 id
 * @returns {subAgentBatch_t[]} 批次列表
 */
export function listBatches(username, charId) {
	return [...batches.values()].filter(batch => batch.username === username && batch.charId === charId)
}

/**
 * 注册运行。
 * @param {subAgentRun_t} run 运行对象
 * @returns {subAgentRun_t} 原对象
 */
export function createRun(run) {
	runs.set(run.runId, run)
	return run
}

/**
 * @param {string} runId 运行 id
 * @returns {subAgentRun_t | undefined} 运行
 */
export function getRun(runId) {
	return runs.get(runId)
}

/**
 * 删除运行，并在其所在批次已无任何运行时一并删除该批次。
 *
 * 生命周期：动作结束并通知父代后，该 run（及其空批次）即视为失效，再次使用该 id 属于未定义行为，故直接释放而不驻留。
 * @param {string} runId 运行 id
 * @returns {boolean} 是否删除成功
 */
export function deleteRun(runId) {
	const run = runs.get(runId)
	if (!run) return false
	runs.delete(runId)
	if (run.batchId && ![...runs.values()].some(candidate => candidate.batchId === run.batchId))
		batches.delete(run.batchId)
	return true
}

/**
 * 兜底清理：淘汰超 TTL 的终态运行与已无运行引用的批次（正常路径由 deleteRun 即时释放）。
 * @param {number} [now] 当前时间
 * @returns {void}
 */
export function pruneSubAgentState(now = Date.now()) {
	for (const run of runs.values())
		if (run.state !== 'running' && run.state !== 'summarizing' && now - (run.finishedAt ?? run.createdAt) >= STATE_TTL_MS)
			runs.delete(run.runId)
	for (const batch of batches.values())
		if (now - batch.createdAt >= STATE_TTL_MS && ![...runs.values()].some(run => run.batchId === batch.batchId))
			batches.delete(batch.batchId)
}

/**
 * 列出运行（可选按用户/角色/父运行过滤）。
 * @param {{ username?: string, charId?: string, parentRunId?: string | null, batchId?: string }} [filter] 过滤条件
 * @returns {subAgentRun_t[]} 运行列表
 */
export function listRuns(filter = {}) {
	return [...runs.values()].filter(run =>
		(filter.username === undefined || run.username === filter.username) &&
		(filter.charId === undefined || run.charId === filter.charId) &&
		(filter.batchId === undefined || run.batchId === filter.batchId) &&
		(filter.parentRunId === undefined || run.parentRunId === filter.parentRunId)
	)
}

/**
 * 沿 `parentRunId` 链给当前运行与每个祖先各累加一轮。
 * @param {subAgentRun_t} run 当前运行
 * @param {(runId: string) => subAgentRun_t | undefined} lookup 运行查询
 * @param {Set<subAgentRun_t>} [seen] 环保护
 * @returns {number} 本次累加的运行数量
 */
export function propagateRoundsToAncestors(run, lookup, seen = new Set()) {
	if (!run || seen.has(run)) return 0
	seen.add(run)
	run.rounds = (run.rounds ?? 0) + 1
	let count = 1
	if (run.parentRunId) {
		const parent = lookup(run.parentRunId)
		if (parent) count += propagateRoundsToAncestors(parent, lookup, seen)
	}
	return count
}

/**
 * 当前运行自身的轮次是否已达上限。
 * @param {subAgentRun_t} run 运行
 * @returns {boolean} 是否超限
 */
export function isRunRoundExceeded(run) {
	return run.roundLimit != null && (run.rounds ?? 0) >= run.roundLimit
}

/**
 * 当前运行自身是否已过截止时间。
 * @param {subAgentRun_t} run 运行
 * @param {number} [now] 当前时间
 * @returns {boolean} 是否超时
 */
export function isRunTimeExceeded(run, now = Date.now()) {
	return run.deadline != null && now >= run.deadline
}

/**
 * 沿父链判定：当前运行或任一祖先超限（轮次或时间）即为超限。
 * @param {subAgentRun_t} run 当前运行
 * @param {(runId: string) => subAgentRun_t | undefined} lookup 运行查询
 * @param {number} [now] 当前时间
 * @param {Set<subAgentRun_t>} [seen] 环保护
 * @returns {boolean} 是否超限
 */
export function isRunOverLimit(run, lookup, now = Date.now(), seen = new Set()) {
	if (!run || seen.has(run)) return false
	seen.add(run)
	if (isRunRoundExceeded(run) || isRunTimeExceeded(run, now)) return true
	if (!run.parentRunId) return false
	return isRunOverLimit(lookup(run.parentRunId), lookup, now, seen)
}

/**
 * 统计某角色当前活跃（running/summarizing）的运行数量。
 * @param {string} username 用户
 * @param {string} charId 角色 id
 * @returns {number} 活跃数量
 */
export function countActiveRunsForAgent(username, charId) {
	return [...runs.values()].filter(run =>
		run.username === username && run.charId === charId &&
		(run.state === 'running' || run.state === 'summarizing')
	).length
}

/**
 * 统计某批次内仍在进行（running/summarizing）的运行数量。
 * @param {string} batchId 批次 id
 * @returns {number} 进行中数量
 */
export function countActiveRunsInBatch(batchId) {
	return [...runs.values()].filter(run =>
		run.batchId === batchId && (run.state === 'running' || run.state === 'summarizing')
	).length
}

/**
 * 清空全部内存状态（仅供测试）。
 * @returns {void}
 */
export function resetSubAgentState() {
	batches.clear()
	runs.clear()
}
