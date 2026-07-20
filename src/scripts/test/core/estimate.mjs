/**
 * 待运行套件耗时预估：串行累加 + 虚拟并行调度模拟。
 */
import { MiB } from './concurrency.mjs'
import { resolveSuiteResources } from './resources.mjs'
import { parallelRatePct as calcParallelRatePct } from './run_timing.mjs'
import {
	getSuiteBaselineDurationMs,
	suiteKey,
} from './state.mjs'

/** 关键路径上每个套件的派发/spawn 开销（毫秒）。 */
export const GAP_OVERHEAD_MS = 130

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./state.mjs').SuiteStateEntry} SuiteStateEntry
 */

/**
 * @typedef {object} EstimateTask
 * @property {string} key
 * @property {string} manifestId
 * @property {string} name
 * @property {number | null} durationMs
 * @property {boolean} reused
 * @property {boolean} blocked 预计因依赖未满足瞬间 blocked（计 0 耗时）
 * @property {number} memMb
 * @property {number} cpuPct
 * @property {boolean} heavy
 * @property {string[]} deps
 */

/**
 * @typedef {object} ParallelMakespan
 * @property {number} makespanMs 墙钟耗时
 * @property {number} criticalPathCount 最长背靠背串行链上的套件数
 */

/**
 * @param {EstimateTask} task 任务
 * @returns {number} 有效耗时（毫秒）
 */
function taskDurationMs(task) {
	return task.reused || task.blocked ? 0 : task.durationMs ?? 0
}

/**
 * 估算本次将跑的墙钟耗时（毫秒）。
 * 无子测试 → baselineDurationMs；
 * 有子测试 → overhead + Σ(子测试 baseline；缺失时用已知均值或全量均摊)。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string[] | undefined} subtestsToRun 本次子测试；省略 = 全部
 * @returns {number | null} 预估毫秒；无任何基线时 null
 */
export function expectedRunDurationMs(suite, entry, subtestsToRun) {
	if (!suite.subtests?.length)
		return getSuiteBaselineDurationMs(entry) ?? null

	const names = subtestsToRun?.length
		? subtestsToRun
		: suite.subtests.map(st => st.name)
	if (!names.length) return 0

	const known = suite.subtests
		.map(st => entry?.subtests?.[st.name]?.durationMs)
		.filter(ms => ms != null && Number.isFinite(ms) && ms > 0)
	const knownMean = known.length
		? known.reduce((a, b) => a + b, 0) / known.length
		: null

	const fullBaseline = getSuiteBaselineDurationMs(entry)
	const overhead = entry?.baselineOverheadMs
	const perFallback = knownMean
		?? (fullBaseline != null
			? Math.max(0, fullBaseline - (overhead ?? 0)) / suite.subtests.length
			: null)

	let sum = 0
	let any = false
	for (const name of names) {
		const ms = entry?.subtests?.[name]?.durationMs
		if (ms != null && Number.isFinite(ms) && ms > 0) {
			sum += ms
			any = true
		}
		else if (perFallback != null) {
			sum += perFallback
			any = true
		}
	}
	if (!any) return fullBaseline ?? null
	return Math.round(sum + (overhead ?? 0))
}

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {{ reused?: boolean, subtestsToRun?: string[] }} [options] 选项
 * @returns {EstimateTask} 预估任务
 */
export function buildEstimateTask(suite, entry, { reused = false, subtestsToRun } = {}) {
	const key = suiteKey(suite.manifestId, suite.name)
	const resources = resolveSuiteResources(suite, entry)
	return {
		key,
		manifestId: suite.manifestId,
		name: suite.name,
		durationMs: reused ? 0 : expectedRunDurationMs(suite, entry, subtestsToRun),
		reused,
		blocked: false,
		memMb: resources.memMb,
		cpuPct: resources.cpuPct,
		heavy: !!suite.heavy,
		deps: (suite.dependencies ?? []).map(dep => suiteKey(dep.manifestId, dep.name)),
	}
}

/**
 * @param {import('./plan.mjs').PlanSlot[]} slots 计划槽位（拓扑序）
 * @param {import('./state.mjs').TestState} state 现状库
 * @returns {EstimateTask[]} 预估任务
 */
export function buildEstimateTasksFromPlan(slots, state) {
	return slots.map(slot => {
		const entry = state.suites[slot.key]
		const resources = resolveSuiteResources(slot.suite, entry)
		return {
			key: slot.key,
			manifestId: slot.suite.manifestId,
			name: slot.suite.name,
			durationMs: slot.action === 'reuse'
				? 0
				: expectedRunDurationMs(slot.suite, entry, slot.subtestsToRun),
			reused: slot.action === 'reuse',
			blocked: slot.action === 'blocked',
			memMb: resources.memMb,
			cpuPct: resources.cpuPct,
			heavy: !!slot.suite.heavy,
			deps: (slot.suite.dependencies ?? []).map(dep => suiteKey(dep.manifestId, dep.name)),
		}
	})
}

/**
 * @param {EstimateTask[]} tasks 任务列表
 * @returns {number} 串行累加耗时（毫秒）
 */
export function serialSumMs(tasks) {
	return tasks.reduce((sum, task) => sum + taskDurationMs(task), 0)
}

/**
 * @param {number} makespanMs 墙钟耗时
 * @param {number} gapCount 关键路径套件数
 * @returns {number} 单点 ETA（毫秒）
 */
export function estimateEtaMs(makespanMs, gapCount) {
	return makespanMs + gapCount * GAP_OVERHEAD_MS
}

/**
 * @param {EstimateTask[]} tasks 任务列表
 * @param {object} options 选项
 * @param {number} options.memBudgetBytes 内存预算（字节）
 * @param {number} options.cpuBudgetPct CPU 预算（%）
 * @returns {ParallelMakespan} 并行模拟结果
 */
export function simulateParallelMakespanMs(tasks, { memBudgetBytes, cpuBudgetPct }) {
	if (!tasks.length) return { makespanMs: 0, criticalPathCount: 0 }

	const taskByKey = new Map(tasks.map(task => [task.key, task]))
	/** @type {Set<string>} */
	const completed = new Set(tasks.filter(task => taskDurationMs(task) === 0).map(task => task.key))
	/** @type {Map<string, number>} */
	const depthByKey = new Map()

	let time = 0
	let usedMemBytes = 0
	let usedCpuPct = 0
	let exclusiveRunning = false
	/** @type {{ key: string, endTime: number, memMb: number, cpuPct: number, heavy: boolean, speculative: boolean }[]} */
	let running = []

	/** @returns {number} 已完成任务的最大代际深度 */
	function maxCompletedDepth() {
		let max = 0
		for (const key of completed)
			max = Math.max(max, depthByKey.get(key) ?? 0)
		return max
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @returns {boolean} 依赖是否已完成（复用/零耗时/硬就绪）
	 */
	function depsComplete(task) {
		for (const depKey of task.deps)
			if (taskByKey.has(depKey) && !completed.has(depKey))
				return false
		return true
	}

	/**
	 * 与 PlanRunCoordinator.#canSpeculate 一致：只挂硬跑依赖，不叠投机链。
	 * @param {EstimateTask} task 任务
	 * @returns {boolean} 是否可投机开工
	 */
	function canSpeculate(task) {
		const byKey = new Map(running.map(slot => [slot.key, slot]))
		let anchoredToHard = false
		for (const depKey of task.deps) {
			if (!taskByKey.has(depKey)) continue
			if (completed.has(depKey)) continue
			const slot = byKey.get(depKey)
			if (!slot || slot.speculative) return false
			anchoredToHard = true
		}
		return anchoredToHard
	}

	/** 依赖已全部通过的投机包 → 升为硬锚 */
	function promoteSpeculative() {
		for (const slot of running) {
			if (!slot.speculative) continue
			const task = taskByKey.get(slot.key)
			if (task && depsComplete(task)) slot.speculative = false
		}
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @returns {boolean} 余量是否足够
	 */
	function canFit(task) {
		if (usedMemBytes + task.memMb * MiB > memBudgetBytes) return false
		if (usedCpuPct + task.cpuPct > cpuBudgetPct) return false
		return true
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @returns {number} 填缝分数
	 */
	function fillScore(task) {
		const memAfter = usedMemBytes + task.memMb * MiB
		const cpuAfter = usedCpuPct + task.cpuPct
		return Math.min(memAfter / memBudgetBytes, cpuAfter / cpuBudgetPct)
	}

	/** @returns {EstimateTask[]} 硬就绪（依赖已完成） */
	function listHardReady() {
		const runningKeys = new Set(running.map(slot => slot.key))
		return [...taskByKey.values()].filter(task =>
			!completed.has(task.key)
			&& !runningKeys.has(task.key)
			&& depsComplete(task)
			&& taskDurationMs(task) > 0)
	}

	/** @returns {EstimateTask[]} 可投机（挂靠硬跑依赖） */
	function listSpeculativeReady() {
		const runningKeys = new Set(running.map(slot => slot.key))
		return [...taskByKey.values()].filter(task =>
			!completed.has(task.key)
			&& !runningKeys.has(task.key)
			&& !depsComplete(task)
			&& canSpeculate(task)
			&& taskDurationMs(task) > 0)
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @param {boolean} speculative 是否投机开工
	 */
	function admit(task, speculative) {
		depthByKey.set(task.key, maxCompletedDepth() + 1)
		const duration = taskDurationMs(task)
		if (task.heavy) {
			exclusiveRunning = true
			running.push({
				key: task.key, endTime: time + duration, memMb: 0, cpuPct: 0, heavy: true, speculative: false,
			})
			return
		}
		usedMemBytes += task.memMb * MiB
		usedCpuPct += task.cpuPct
		running.push({
			key: task.key,
			endTime: time + duration,
			memMb: task.memMb,
			cpuPct: task.cpuPct,
			heavy: false,
			speculative,
		})
	}

	/**
	 * @param {EstimateTask[]} candidates light 候选
	 * @param {boolean} requireFit 是否要求能装进当前余量
	 * @returns {EstimateTask | null} 选中的任务
	 */
	function pickLight(candidates, requireFit) {
		let best = null
		let bestScore = -1
		for (const task of candidates) {
			if (requireFit && !canFit(task)) continue
			if (!requireFit) return task
			const score = fillScore(task)
			if (score > bestScore) {
				bestScore = score
				best = task
			}
		}
		return best
	}

	/** 先硬就绪，再余量投机（与 PlanRunCoordinator 同序）。 */
	function tryAdmit() {
		if (exclusiveRunning) return
		promoteSpeculative()

		const idle = usedMemBytes === 0 && usedCpuPct === 0
		if (idle) {
			const hard = listHardReady()
			const heavy = hard.find(task => task.heavy)
			if (heavy) {
				admit(heavy, false)
				return
			}
			const hardLight = hard.filter(task => !task.heavy)
			const start = pickLight(hardLight, true) ?? pickLight(hardLight, false)
			if (start) admit(start, false)
			else {
				const spec = listSpeculativeReady().filter(task => !task.heavy)
				const specStart = pickLight(spec, true) ?? pickLight(spec, false)
				if (specStart) admit(specStart, true)
			}
		}

		for (;;) {
			const best = pickLight(listHardReady().filter(task => !task.heavy), true)
			if (!best) break
			admit(best, false)
		}
		for (;;) {
			const best = pickLight(listSpeculativeReady().filter(task => !task.heavy), true)
			if (!best) break
			admit(best, true)
		}
	}

	/** 复用/零耗时任务瞬时完成，不占深度。 */
	function completeInstant() {
		for (const task of taskByKey.values())
			if (!completed.has(task.key) && depsComplete(task) && taskDurationMs(task) === 0)
				completed.add(task.key)
	}

	while (completed.size < tasks.length) {
		completeInstant()
		tryAdmit()

		if (!running.length) {
			const remaining = [...taskByKey.values()].some(task => !completed.has(task.key))
			if (!remaining) break
			completeInstant()
			tryAdmit()
			if (!running.length) break
			continue
		}

		const nextEnd = Math.min(...running.map(slot => slot.endTime))
		time = nextEnd

		for (const slot of [...running]) {
			if (slot.endTime !== nextEnd) continue
			completed.add(slot.key)
			if (slot.heavy)
				exclusiveRunning = false
			else {
				usedMemBytes -= slot.memMb * MiB
				usedCpuPct -= slot.cpuPct
			}
		}
		running = running.filter(slot => slot.endTime !== nextEnd)
		tryAdmit()
	}

	const criticalPathCount = depthByKey.size ? Math.max(...depthByKey.values()) : 0
	return { makespanMs: time, criticalPathCount }
}

/**
 * @param {EstimateTask[]} tasks 任务列表
 * @param {object} options 选项
 * @param {boolean} options.serial 是否串行模式
 * @param {number} options.memBudgetBytes 内存预算（字节）
 * @param {number} options.cpuBudgetPct CPU 预算（%）
 * @returns {object} 预估汇总
 */
export function summarizeEstimate(tasks, { serial, memBudgetBytes, cpuBudgetPct }) {
	const serialSum = serialSumMs(tasks)
	const { makespanMs: parallelMakespanMs, criticalPathCount: parallelGapCount } =
		simulateParallelMakespanMs(tasks, { memBudgetBytes, cpuBudgetPct })
	const serialGapCount = tasks.filter(task => taskDurationMs(task) > 0).length
	const chosenMakespanMs = serial ? serialSum : parallelMakespanMs
	const gapCount = serial ? serialGapCount : parallelGapCount
	const etaMs = estimateEtaMs(chosenMakespanMs, gapCount)
	const parallelEtaMs = estimateEtaMs(parallelMakespanMs, parallelGapCount)
	const savingsMs = Math.max(0, serialSum - parallelMakespanMs)

	return {
		serial,
		serialSumMs: serialSum,
		parallelMakespanMs,
		chosenMakespanMs,
		etaMs,
		parallelEtaMs,
		parallelRatePct: calcParallelRatePct(serialSum, parallelMakespanMs),
		savingsMs,
		gapCount,
		parallelGapCount,
		runCount: tasks.filter(task => !task.reused && !task.blocked).length,
		reusedCount: tasks.filter(task => task.reused).length,
		blockedCount: tasks.filter(task => task.blocked).length,
	}
}
