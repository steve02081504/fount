/** code 运行统计：提供方用量与实际计时分别记录。 */

/**
 * 计算执行区间的并集，避免重复累计并行任务的等待时间。
 * @param {object[]} intervals - 各段已测得的执行区间。
 * @returns {number} 毫秒数。
 */
export function intervalUnionMs(intervals) {
	const sorted = intervals.filter(item => Number.isFinite(item.startedAt) && Number.isFinite(item.finishedAt) && item.finishedAt >= item.startedAt)
		.map(item => [item.startedAt, item.finishedAt]).sort((a, b) => a[0] - b[0])
	let total = 0, end = -Infinity
	for (const [start, finish] of sorted) {
		total += Math.max(0, finish - Math.max(start, end))
		end = Math.max(end, finish)
	}
	return total
}

/**
 * 从权威运行快照汇总会话性能，并按运行标识去重。
 * @param {object} statistics - 已持久化的会话统计。
 * @param {object} usage - 提供方计量。
 * @param {object[]} entries - 已持久化的异步结算条目。
 * @returns {object} 展示用指标；缺测的项为 null。
 */
export function summarizeStatistics(statistics = {}, usage = {}, entries = []) {
	const runs = statistics.runs ?? []
	const calls = runs.flatMap(run => run.calls ?? [])
	const tools = runs.flatMap(run => run.tools ?? [])
	const asyncTasks = new Map([...runs.flatMap(run => run.asyncTasks ?? []), ...statistics.asyncTasks ?? []].map(task => [task.callId, task]))
	for (const entry of entries) {
		const work = entry.extension?.asyncWork
		if (work) asyncTasks.set(work.callId, work)
		for (const task of entry.extension?.asyncAwait?.settled ?? []) asyncTasks.set(`async:${task.id}`, task)
	}
	const measured = calls.filter(call => Number.isFinite(call.finishedAt))
	const first = measured.filter(call => Number.isFinite(call.firstOutputAt))
	const speed = first.filter(call => Number.isFinite(call.outputTokens) && call.finishedAt > call.firstOutputAt)
	const outputMs = speed.reduce((sum, call) => sum + call.finishedAt - call.firstOutputAt, 0)
	const cached = (usage.calls ?? []).filter(call => Number.isFinite(call.inputTokens) && Number.isFinite(call.cacheReadTokens))
	const cacheInput = cached.reduce((sum, call) => sum + call.inputTokens, 0)
	const latest = runs.at(-1)
	return {
		rounds: runs.length,
		steps: calls.length,
		modelMs: measured.length ? measured.reduce((sum, call) => sum + Math.max(0, call.finishedAt - call.startedAt), 0) : null,
		toolMs: tools.length ? tools.reduce((sum, tool) => sum + Math.max(0, (tool.finishedAt ?? tool.startedAt) - tool.startedAt), 0) : null,
		toolWaitMs: intervalUnionMs(tools),
		toolCount: tools.length,
		asyncMs: [...asyncTasks.values()].some(task => Number.isFinite(task.finishedAt)) ? [...asyncTasks.values()].reduce((sum, task) => sum + (Number.isFinite(task.finishedAt) ? Math.max(0, task.finishedAt - task.startedAt) : 0), 0) : null,
		ttftMs: first.length ? first.reduce((sum, call) => sum + call.firstOutputAt - call.startedAt, 0) / first.length : null,
		ttftCount: first.length,
		tps: outputMs > 0 ? speed.reduce((sum, call) => sum + call.outputTokens, 0) * 1000 / outputMs : null,
		cacheRate: cacheInput > 0 ? cached.reduce((sum, call) => sum + call.cacheReadTokens, 0) / cacheInput : null,
		cacheIncomplete: cached.length !== (usage.calls?.length ?? 0) || calls.some(call => call.inputTokens == null || call.cacheReadTokens == null),
		context: latest?.context ?? null,
	}
}

/**
 * 替换同一运行的统计快照，避免重复累计消耗。
 * @param {object} statistics - 现有会话统计。
 * @param {object} run - 最新运行快照。
 * @returns {object} 更新后的会话统计。
 */
export function mergeRunStatistics(statistics, run) {
	const runs = [...statistics?.runs ?? []]
	const index = runs.findIndex(item => item.runId === run.runId)
	if (index < 0) runs.push(run)
	else runs[index] = run
	return { ...statistics, runs }
}

/**
 * 独立于可编辑的消息历史保留后台任务的结算耗时。
 * @param {object} statistics - 会话统计。
 * @param {object[]} entries - 异步通知或 `<await-async>` 结果条目。
 * @returns {object} 更新后的会话统计。
 */
export function mergeAsyncStatistics(statistics, entries = []) {
	const tasks = new Map((statistics?.asyncTasks ?? []).map(task => [task.callId, task]))
	for (const entry of entries) {
		const work = entry.extension?.asyncWork
		if (work) tasks.set(work.callId, work)
		for (const task of entry.extension?.asyncAwait?.settled ?? []) {
			const callId = `async:${task.id}`
			tasks.set(callId, { ...task, callId })
		}
	}
	return tasks.size ? { ...statistics, asyncTasks: [...tasks.values()] } : statistics
}
