/**
 * 【文件】public/src/endpoints.mjs — agent_studio 前端 HTTP 客户端
 * 【职责】以命名导出封装 `shells:agent_studio` 的全部 REST 调用；UI / 模板层不得直接 `fetch`。
 * 【原理】统一 `requestJson` 处理非 2xx：抛出带服务端 `message` 的错误。
 * 【关联】后端 src/endpoints.mjs；public/index.mjs 消费。
 */

/** API 前缀。 */
const API_BASE = '/api/parts/shells:agent_studio'

/**
 * 发送请求并解析 JSON。
 * @param {string} path 相对路径
 * @param {RequestInit} [options] fetch 选项
 * @returns {Promise<any>} 响应 JSON
 */
async function requestJson(path, options = {}) {
	const response = await fetch(API_BASE + path, options)
	if (!response.ok) {
		const body = await response.json().catch(() => ({}))
		throw new Error(body.message || body.error || response.statusText)
	}
	if (response.status === 204) return null
	return response.json()
}

/**
 * 列出全部角色。
 * @returns {Promise<Array<{ id: string, info: object | null }>>} 角色列表
 */
export function listChars() {
	return requestJson('/chars')
}

/**
 * 获取角色概览。
 * @param {string} charId 角色 id
 * @param {{ limit?: number }} [options] 选项
 * @returns {Promise<object>} 概览
 */
export function getCharOverview(charId, options = {}) {
	const params = new URLSearchParams()
	if (options.limit) params.set('limit', String(options.limit))
	const query = params.toString()
	return requestJson(`/char/${encodeURIComponent(charId)}/overview${query ? '?' + query : ''}`)
}

/**
 * 列出角色的子代理运行与批次，或某会话（chatId）的子代理运行。
 * @param {{ charId?: string, chatId?: string } | string} filter 过滤条件（字符串视为 charId）
 * @returns {Promise<{ runs: object[], batches: object[] }>} 运行与批次
 */
export function listSubAgents(filter) {
	const { charId, chatId } = typeof filter === 'string' ? { charId: filter } : filter ?? {}
	const params = new URLSearchParams()
	if (charId) params.set('charId', charId)
	if (chatId) params.set('chatId', chatId)
	return requestJson(`/subagents?${params.toString()}`)
}

/**
 * 读取单次子代理运行的完整状态与内部对话。
 * @param {string} runId 运行 id
 * @returns {Promise<object>} 运行详情（含 conversation）
 */
export function getSubAgent(runId) {
	return requestJson(`/subagent/${encodeURIComponent(runId)}`)
}

/**
 * 列出生成记录。
 * @param {object} [filter] 过滤条件
 * @returns {Promise<object[]>} 记录摘要
 */
export function listGenerations(filter = {}) {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(filter))
		if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
	const query = params.toString()
	return requestJson(`/generations${query ? '?' + query : ''}`)
}

/**
 * 获取单条生成记录。
 * @param {string} id 记录 id
 * @returns {Promise<object>} 记录
 */
export function getGeneration(id) {
	return requestJson(`/generation/${encodeURIComponent(id)}`)
}

/**
 * 构建生成链森林。
 * @param {object} [filter] 过滤条件
 * @returns {Promise<object[]>} 链根列表
 */
export function listChains(filter = {}) {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(filter))
		if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
	const query = params.toString()
	return requestJson(`/chains${query ? '?' + query : ''}`)
}

/**
 * 读取保留策略。
 * @returns {Promise<{ promptMs: number, conversationMs: number }>} 保留策略
 */
export function getRetention() {
	return requestJson('/retention')
}

/**
 * 更新保留策略。
 * @param {{ promptMs?: number, conversationMs?: number }} retention 保留策略
 * @returns {Promise<{ promptMs: number, conversationMs: number }>} 更新后的保留策略
 */
export function setRetention(retention) {
	return requestJson('/retention', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(retention),
	})
}

/**
 * 列出基准定义。
 * @returns {Promise<object[]>} 基准列表
 */
export function listBenchmarks() {
	return requestJson('/benchmarks')
}

/**
 * 读取单个基准定义。
 * @param {string} id 基准 id
 * @returns {Promise<object>} 基准
 */
export function getBenchmark(id) {
	return requestJson(`/benchmarks/${encodeURIComponent(id)}`)
}

/**
 * 创建基准定义。
 * @param {object} benchmark 基准字段
 * @returns {Promise<object>} 已创建的基准
 */
export function createBenchmark(benchmark) {
	return requestJson('/benchmarks', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(benchmark),
	})
}

/**
 * 更新基准定义。
 * @param {string} id 基准 id
 * @param {object} patch 补丁
 * @returns {Promise<object>} 更新后的基准
 */
export function updateBenchmark(id, patch) {
	return requestJson(`/benchmarks/${encodeURIComponent(id)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch),
	})
}

/**
 * 删除基准定义。
 * @param {string} id 基准 id
 * @returns {Promise<object>} 删除的基准
 */
export function deleteBenchmark(id) {
	return requestJson(`/benchmarks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * 运行基准。
 * @param {string} id 基准 id
 * @param {object} config 运行配置
 * @returns {Promise<object>} 运行结果
 */
export function runBenchmark(id, config) {
	return requestJson(`/benchmarks/${encodeURIComponent(id)}/run`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(config),
	})
}

/**
 * 列出基准运行。
 * @param {object} [filter] 过滤条件
 * @returns {Promise<object[]>} 运行摘要
 */
export function listRuns(filter = {}) {
	const params = new URLSearchParams()
	if (filter.benchmarkId) params.set('benchmarkId', filter.benchmarkId)
	if (filter.charId) params.set('charId', filter.charId)
	const query = params.toString()
	return requestJson(`/runs${query ? '?' + query : ''}`)
}

/**
 * 读取单次基准运行完整结果。
 * @param {string} id 运行 id
 * @returns {Promise<object>} 运行
 */
export function getRun(id) {
	return requestJson(`/runs/${encodeURIComponent(id)}`)
}
