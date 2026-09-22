/**
 * 【文件】src/endpoints.mjs — agent_studio 后端 REST 端点
 * 【职责】注册 `/api/parts/shells:agent_studio/...` 路由：角色、生成历史、生成链、保留策略、基准定义与运行。
 * 【原理】每个路由先 `authenticate`，再 `getUserByReq` 取用户名，转调 `studio.mjs` / `generation_history.mjs`；
 *   失败一律 `throw httpError(code, message)`（由全局 errorHandler 统一响应）。
 * 【关联】main.mjs 调用 `setEndpoints`；public/src/endpoints.mjs 为对应的前端命名导出客户端。
 */
import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'

import { buildChains, getGeneration, getRetention, listGenerations, setRetention } from './generation_history.mjs'
import {
	createBenchmark,
	deleteBenchmark,
	getBenchmark,
	getBenchmarkRun,
	getCharOverview,
	getSubAgentRun,
	listBenchmarkRuns,
	listBenchmarks,
	listChars,
	listSubAgents,
	runBenchmark,
	updateBenchmark,
} from './studio.mjs'

/** 路由前缀。 */
const PREFIX = '/api/parts/shells\\:agent_studio'

/**
 * 解析正整数查询参数。
 * @param {unknown} value 原值
 * @param {number} fallback 缺省值
 * @returns {number} 结果
 */
function positiveInt(value, fallback) {
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/**
 * 从请求中提取生成历史过滤条件。
 * @param {object} query 查询参数
 * @returns {object} 过滤条件
 */
function generationFilter(query = {}) {
	/** @type {object} */
	const filter = {}
	for (const key of ['charId', 'source', 'conversationId', 'chatId', 'runId'])
		if (query[key]) filter[key] = query[key]
	if (query.since) filter.since = Number(query.since)
	if (query.limit) filter.limit = positiveInt(query.limit, 100)
	return filter
}

/**
 * 注册 agent_studio 的全部端点。
 * @param {object} router Express 路由实例
 * @returns {void}
 */
export function setEndpoints(router) {
	router.get(`${PREFIX}/chars`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await listChars(username))
	})

	router.get(`${PREFIX}/char/:id/overview`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await getCharOverview(username, req.params.id, { limit: positiveInt(req.query.limit, 50) }))
	})

	router.get(`${PREFIX}/subagents`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await listSubAgents(username, { charId: req.query.charId, chatId: req.query.chatId }))
	})

	router.get(`${PREFIX}/subagent/:runId`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await getSubAgentRun(username, req.params.runId))
	})

	router.get(`${PREFIX}/generations`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await listGenerations(username, generationFilter(req.query)))
	})

	router.get(`${PREFIX}/generation/:id`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const record = await getGeneration(username, req.params.id)
		if (!record) throw httpError(404, `generation not found: ${req.params.id}`)
		res.status(200).json(record)
	})

	router.get(`${PREFIX}/chains`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const records = await listGenerations(username, generationFilter(req.query))
		res.status(200).json(buildChains(records))
	})

	router.get(`${PREFIX}/retention`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await getRetention(username))
	})

	router.put(`${PREFIX}/retention`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await setRetention(username, req.body ?? {}))
	})

	router.get(`${PREFIX}/benchmarks`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(listBenchmarks(username))
	})

	router.post(`${PREFIX}/benchmarks`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(201).json(createBenchmark(username, req.body ?? {}))
	})

	router.get(`${PREFIX}/benchmarks/:id`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(getBenchmark(username, req.params.id))
	})

	router.put(`${PREFIX}/benchmarks/:id`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(updateBenchmark(username, req.params.id, req.body ?? {}))
	})

	router.delete(`${PREFIX}/benchmarks/:id`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(deleteBenchmark(username, req.params.id))
	})

	router.post(`${PREFIX}/benchmarks/:id/run`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await runBenchmark(username, req.params.id, req.body ?? {}))
	})

	router.get(`${PREFIX}/runs`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(listBenchmarkRuns(username, { benchmarkId: req.query.benchmarkId, charId: req.query.charId }))
	})

	router.get(`${PREFIX}/runs/:id`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(getBenchmarkRun(username, req.params.id))
	})
}
