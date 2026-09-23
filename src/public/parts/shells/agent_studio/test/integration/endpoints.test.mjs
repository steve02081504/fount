/* global Deno */
/**
 * agent_studio 集成测试：路由注册冒烟、子代理运行纯聚合、基准请求身份规则。
 */
import { assertEquals } from 'jsr:@std/assert'

import { buildBenchmarkRequest, summarizeSubAgentRuns } from '../../src/studio.mjs'

const PREFIX = '/api/parts/shells\\:agent_studio'

/**
 * 构造记录路由的假 Express router。
 * @returns {{ routes: Array<{method: string, path: string}>, get: Function, post: Function, put: Function, delete: Function }} 假 router
 */
function createFakeRouter() {
	const routes = []
	/**
	 * 生成注册函数。
	 * @param {string} method HTTP 方法
	 * @returns {Function} 注册函数
	 */
	const register = method => (path, ...handlers) => {
		routes.push({ method, path, handlers })
	}
	return { routes, get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE') }
}

Deno.test('setEndpoints registers the full agent_studio REST surface', async () => {
	const { setEndpoints } = await import('../../src/endpoints.mjs')
	const router = createFakeRouter()
	setEndpoints(router)
	const registered = router.routes.map(route => `${route.method} ${route.path}`).sort()
	const expected = [
		`GET ${PREFIX}/chars`,
		`GET ${PREFIX}/char/:id/overview`,
		`GET ${PREFIX}/subagents`,
		`GET ${PREFIX}/subagent/:runId`,
		`GET ${PREFIX}/generations`,
		`DELETE ${PREFIX}/generations`,
		`GET ${PREFIX}/generation/:id`,
		`GET ${PREFIX}/conversations`,
		`GET ${PREFIX}/conversation/:key`,
		`GET ${PREFIX}/chains`,
		`GET ${PREFIX}/retention`,
		`PUT ${PREFIX}/retention`,
		`GET ${PREFIX}/benchmarks`,
		`POST ${PREFIX}/benchmarks`,
		`GET ${PREFIX}/benchmarks/:id`,
		`PUT ${PREFIX}/benchmarks/:id`,
		`DELETE ${PREFIX}/benchmarks/:id`,
		`POST ${PREFIX}/benchmarks/:id/run`,
		`GET ${PREFIX}/runs`,
		`GET ${PREFIX}/runs/:id`,
	].sort()
	assertEquals(registered, expected)
	for (const route of router.routes)
		assertEquals(typeof route.handlers.at(-1), 'function')
})

Deno.test('summarizeSubAgentRuns merges history, live state and batches', () => {
	const records = [
		{ id: 'g1', subAgent: { runId: 'r1', batchId: 'b1' }, startedAt: 100, finishedAt: 120 },
		{ id: 'g2', subAgent: { runId: 'r1', batchId: 'b1' }, startedAt: 90, finishedAt: 130, hasError: true },
		{ id: 'g3', subAgent: { runId: 'r2' }, startedAt: 200 },
	]
	const liveRuns = [{ runId: 'r2', state: 'running', rounds: 2, roundLimit: 8, depth: 1, isAsync: true }]
	const liveBatches = [{ batchId: 'b1', commonContext: 'ctx' }]
	const { runs, batches } = summarizeSubAgentRuns(records, liveRuns, liveBatches)

	assertEquals(runs.map(run => run.runId), ['r2', 'r1'])
	const r1 = runs.find(run => run.runId === 'r1')
	assertEquals(r1.generationIds, ['g1', 'g2'])
	assertEquals(r1.startedAt, 90)
	assertEquals(r1.finishedAt, 130)
	assertEquals(r1.hasError, true)
	const r2 = runs.find(run => run.runId === 'r2')
	assertEquals(r2.live.state, 'running')
	assertEquals(r2.generationIds, ['g3'])
	assertEquals(batches, [{ batchId: 'b1', commonContext: 'ctx', runIds: ['r1'] }])
})

Deno.test('buildBenchmarkRequest keeps the operator as User* and puts the case in chat_log', () => {
	const benchmark = { id: 'bench-1', name: 'demo' }
	const caseItem = { id: 'case-1', input: 'say hi' }
	const run = { id: 'run-1' }
	const request = buildBenchmarkRequest({
		username: 'alice',
		charId: 'demo-char',
		benchmark,
		caseItem,
		char: { interfaces: {} },
		charInfo: { name: 'Demo' },
		run,
	})

	assertEquals(request.username, 'alice')
	assertEquals(request.UserUid, 'user')
	assertEquals(request.UserCharname, 'alice')
	assertEquals(request.CharUid, 'char')
	assertEquals(request.Charname, 'Demo')
	assertEquals(request.char_id, 'demo-char')
	assertEquals(request.chat_log.length, 1)
	assertEquals(request.chat_log[0].uid, 'user')
	assertEquals(request.chat_log[0].content, 'say hi')
	assertEquals(request.ReplyToUid, undefined)
	assertEquals(request.world.distribution, 'local')
	assertEquals(request.user.info['zh-CN'].name, '（无人格）')
	assertEquals(request.ai_source, undefined)
})

Deno.test('buildBenchmarkRequest forwards a request-level AI source', () => {
	const aiSource = { filename: 'fake.mjs' }
	const request = buildBenchmarkRequest({
		username: 'alice',
		charId: 'demo-char',
		benchmark: { id: 'bench-1' },
		caseItem: { id: 'case-1', input: 'x' },
		char: {},
		charInfo: {},
		run: { id: 'run-1' },
		aiSource,
	})
	assertEquals(request.ai_source, aiSource)
})
