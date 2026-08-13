/**
 * 待运行套件耗时预估：串行累加 + 虚拟并行调度模拟。
 */
import { MiB } from './concurrency.mjs'
import { declaredOverheadMs } from './expected.mjs'
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
 * 耗时预估任务（单 suite 槽位）。
 * @typedef {object} EstimateTask
 * @property {string} [id] 队列实例 id（缺省 = key；重复 suite 不可折叠）
 * @property {string} key suite 键
 * @property {string} manifestId manifest id
 * @property {string} name suite 名
 * @property {number | null} durationMs 预估耗时（毫秒）
 * @property {number} [elapsedMs] 已运行毫秒（在跑项）
 * @property {boolean} [running] 是否已占用资源
 * @property {boolean} reused 是否复用（计 0 耗时）
 * @property {boolean} blocked 预计因依赖未满足瞬间 blocked（计 0 耗时）
 * @property {number} memMb 内存预算（MB）
 * @property {number} cpuPct CPU 预算（%）
 * @property {boolean} heavy 是否 heavy 独占
 * @property {number} [moduleCheckMs] 模组检查互斥时长（不可与其它检查重叠）
 * @property {string[]} deps 依赖 suite 键列表
 */

/**
 * 并行模拟墙钟结果。
 * @typedef {object} ParallelMakespan
 * @property {number} makespanMs 墙钟耗时
 * @property {number} criticalPathCount 最长背靠背串行链上的套件数
 */

/**
 * 任务实例 id：显式 id 优先，避免同 key 折叠。
 * @param {EstimateTask} task 任务
 * @returns {string} 实例 id
 */
function taskId(task) {
	return task.id ?? task.key
}

/**
 * 计算任务剩余耗时（复用/blocked 计 0；未知为 null）。
 * @param {EstimateTask} task 任务
 * @returns {number | null} 剩余毫秒
 */
export function remainingDurationMs(task) {
	if (task.reused || task.blocked) return 0
	if (!Number.isFinite(task.durationMs)) return null
	return Math.max(0, task.durationMs - (task.elapsedMs ?? 0))
}

/**
 * 计算任务有效耗时（复用/blocked/未知计 0）。
 * @param {EstimateTask} task 任务
 * @returns {number} 有效耗时（毫秒）
 */
function taskDurationMs(task) {
	return remainingDurationMs(task) ?? 0
}

/**
 * 真跑但无基线：模拟里不得当成已完成。
 * @param {EstimateTask} task 任务
 * @returns {boolean} 是否未知耗时
 */
function isUnknownRunDuration(task) {
	return remainingDurationMs(task) == null
}

/**
 * 子测试耗时：现状 EMA 优先，否则 manifest `expected`。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string} name 子测试名
 * @returns {number | null} 毫秒
 */
function subtestDurationMs(suite, entry, name) {
	const sample = entry?.subtests?.[name]?.durationMs
	if (sample != null && Number.isFinite(sample) && sample > 0) return sample
	const declared = suite.subtests?.find(st => st.name === name)?.expectedMs
	return declared != null && Number.isFinite(declared) && declared > 0 ? declared : null
}

/**
 * 估算本次将跑的墙钟耗时（毫秒）。
 * 无子测试 → 现状 baselineDurationMs，缺则 manifest `expected`；
 * 有子测试 → overhead + Σ(子测试 baseline / expected；缺失时用已知均值或全量均摊)。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string[] | undefined} subtestsToRun 本次子测试；省略 = 全部
 * @returns {number | null} 预估毫秒；无任何基线时 null
 */
export function expectedRunDurationMs(suite, entry, subtestsToRun) {
	if (!suite.subtests?.length)
		return getSuiteBaselineDurationMs(entry) ?? suite.expectedMs ?? null

	const names = subtestsToRun?.length
		? subtestsToRun
		: suite.subtests.map(st => st.name)
	if (!names.length) return 0

	const known = suite.subtests
		.map(st => subtestDurationMs(suite, entry, st.name))
		.filter(ms => ms != null && Number.isFinite(ms) && ms > 0)
	const knownMean = known.length
		? known.reduce((a, b) => a + b, 0) / known.length
		: null

	const fullBaseline = getSuiteBaselineDurationMs(entry) ?? suite.expectedMs ?? null
	const overhead = entry?.baselineOverheadMs ?? declaredOverheadMs(suite)
	const perFallback = knownMean
		?? (fullBaseline != null
			? Math.max(0, fullBaseline - (overhead ?? 0)) / suite.subtests.length
			: null)

	let sum = 0
	let any = false
	for (const name of names) {
		const ms = subtestDurationMs(suite, entry, name)
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
 * 构造单 suite 预估任务。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {{ reused?: boolean, subtestsToRun?: string[] }} [options] 选项
 * @returns {EstimateTask} 预估任务
 */
export function buildEstimateTask(suite, entry, {
	reused = false,
	subtestsToRun,
	moduleCheckMs = 0,
	id,
	elapsedMs = 0,
	running = false,
} = {}) {
	const key = suiteKey(suite.manifestId, suite.name)
	const resources = resolveSuiteResources(suite, entry)
	return {
		id: id ?? key,
		key,
		manifestId: suite.manifestId,
		name: suite.name,
		durationMs: reused ? 0 : expectedRunDurationMs(suite, entry, subtestsToRun),
		elapsedMs,
		running,
		reused,
		blocked: false,
		memMb: resources.memMb,
		cpuPct: resources.cpuPct,
		heavy: !!suite.heavy,
		moduleCheckMs: reused ? 0 : moduleCheckMs,
		deps: (suite.dependencies ?? []).map(dep => suiteKey(dep.manifestId, dep.name)),
	}
}

/**
 * 由计划槽位构造预估任务列表。
 * @param {import('./plan.mjs').PlanSlot[]} slots 计划槽位（拓扑序）
 * @param {import('./state.mjs').TestState} state 现状库
 * @returns {EstimateTask[]} 预估任务
 */
export function buildEstimateTasksFromPlan(slots, state) {
	return slots.map(slot => {
		const entry = state.suites[slot.key]
		const resources = resolveSuiteResources(slot.suite, entry)
		return {
			id: slot.key,
			key: slot.key,
			manifestId: slot.suite.manifestId,
			name: slot.suite.name,
			durationMs: slot.action === 'reuse'
				? 0
				: expectedRunDurationMs(slot.suite, entry, slot.subtestsToRun),
			reused: slot.action === 'reuse',
			blocked: slot.action === 'blocked' || slot.action === 'skipped',
			memMb: resources.memMb,
			cpuPct: resources.cpuPct,
			heavy: !!slot.suite.heavy,
			moduleCheckMs: 0,
			deps: (slot.suite.dependencies ?? []).map(dep => suiteKey(dep.manifestId, dep.name)),
		}
	})
}

/**
 * 串行累加全部任务有效耗时。
 * @param {EstimateTask[]} tasks 任务列表
 * @returns {number} 串行累加耗时（毫秒）
 */
export function serialSumMs(tasks) {
	return tasks.reduce((sum, task) => sum + taskDurationMs(task), 0)
}

/**
 * 由墙钟与关键路径套件数估算单点 ETA。
 * @param {number} makespanMs 墙钟耗时
 * @param {number} gapCount 关键路径套件数
 * @returns {number} 单点 ETA（毫秒）
 */
export function estimateEtaMs(makespanMs, gapCount) {
	return makespanMs + gapCount * GAP_OVERHEAD_MS
}

/**
 * 虚拟并行调度模拟墙钟耗时。
 * 默认与 PlanRunCoordinator 同策略（一层乐观重叠）；`speculative: false` 只按硬就绪。
 * @param {EstimateTask[]} tasks 任务列表
 * @param {object} options 选项
 * @param {number} options.memBudgetBytes 内存预算（字节）
 * @param {number} options.cpuBudgetPct CPU 预算（%）
 * @param {boolean} [options.speculative=true] 是否模拟一层依赖重叠
 * @returns {ParallelMakespan} 并行模拟结果
 */
export function simulateParallelMakespanMs(tasks, { memBudgetBytes, cpuBudgetPct, speculative = true }) {
	if (!tasks.length) return { makespanMs: 0, criticalPathCount: 0 }

	const tasksById = new Map(tasks.map(task => [taskId(task), task]))
	const instancesByKey = new Map()
	for (const task of tasks) {
		const list = instancesByKey.get(task.key) ?? []
		list.push(task)
		instancesByKey.set(task.key, list)
	}
	/** @type {Set<string>} */
	const completed = new Set()
	/** @type {Map<string, number>} */
	const depthById = new Map()

	let time = 0
	let usedMemBytes = 0
	let usedCpuPct = 0
	let exclusiveRunning = false
	let checkFreeAt = 0
	/** @type {{ id: string, key: string, endTime: number, memMb: number, cpuPct: number, heavy: boolean, speculative: boolean }[]} */
	let running = []

	/** @returns {number} 已完成任务的最大代际深度 */
	function maxCompletedDepth() {
		let max = 0
		for (const id of completed)
			max = Math.max(max, depthById.get(id) ?? 0)
		return max
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @returns {boolean} 依赖是否已完成
	 */
	function depsComplete(task) {
		for (const depKey of task.deps) {
			const deps = instancesByKey.get(depKey)
			if (!deps?.length) continue
			if (deps.some(dep => isUnknownRunDuration(dep))) return false
			if (deps.some(dep => !completed.has(taskId(dep)))) return false
		}
		return true
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @returns {boolean} 是否可投机开工
	 */
	function canSpeculate(task) {
		if (!speculative) return false
		const byKey = new Map(running.map(slot => [slot.key, slot]))
		let anchoredToHard = false
		for (const depKey of task.deps) {
			if (!instancesByKey.has(depKey)) continue
			const deps = instancesByKey.get(depKey)
			if (deps.every(dep => completed.has(taskId(dep)))) continue
			const slot = byKey.get(depKey)
			if (!slot || slot.speculative) return false
			anchoredToHard = true
		}
		return anchoredToHard
	}

	/**
	 * 依赖已齐的投机占用升为硬占用。
	 */
	function promoteSpeculative() {
		for (const slot of running) {
			if (!slot.speculative) continue
			const task = tasksById.get(slot.id)
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

	/** @returns {EstimateTask[]} 硬就绪 */
	function listHardReady() {
		const runningIds = new Set(running.map(slot => slot.id))
		return [...tasksById.values()].filter(task =>
			!completed.has(taskId(task))
			&& !runningIds.has(taskId(task))
			&& !task.running
			&& depsComplete(task)
			&& taskDurationMs(task) > 0
			&& !isUnknownRunDuration(task))
	}

	/** @returns {EstimateTask[]} 可投机 */
	function listSpeculativeReady() {
		if (!speculative) return []
		const runningIds = new Set(running.map(slot => slot.id))
		return [...tasksById.values()].filter(task =>
			!completed.has(taskId(task))
			&& !runningIds.has(taskId(task))
			&& !task.running
			&& !depsComplete(task)
			&& canSpeculate(task)
			&& taskDurationMs(task) > 0
			&& !isUnknownRunDuration(task))
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @param {boolean} asSpeculative 是否投机开工
	 * @param {number} [endTime] 已在跑时的结束时刻
	 */
	function occupy(task, asSpeculative, endTime) {
		const id = taskId(task)
		depthById.set(id, maxCompletedDepth() + 1)
		if (task.heavy) {
			exclusiveRunning = true
			running.push({
				id, key: task.key, endTime, memMb: 0, cpuPct: 0, heavy: true, speculative: false,
			})
			return
		}
		usedMemBytes += task.memMb * MiB
		usedCpuPct += task.cpuPct
		running.push({
			id,
			key: task.key,
			endTime,
			memMb: task.memMb,
			cpuPct: task.cpuPct,
			heavy: false,
			speculative: asSpeculative,
		})
	}

	/**
	 * @param {EstimateTask} task 任务
	 * @param {boolean} asSpeculative 是否投机开工
	 */
	function admit(task, asSpeculative) {
		const duration = taskDurationMs(task)
		const spawnAt = Math.max(time, checkFreeAt)
		checkFreeAt = spawnAt + (task.moduleCheckMs ?? 0)
		occupy(task, asSpeculative, spawnAt + duration)
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

	/**
	 * 在预算内尽量接纳硬就绪与投机任务。
	 */
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

		for (; ;) {
			const best = pickLight(listHardReady().filter(task => !task.heavy), true)
			if (!best) break
			admit(best, false)
		}
		for (; ;) {
			const best = pickLight(listSpeculativeReady().filter(task => !task.heavy), true)
			if (!best) break
			admit(best, true)
		}
	}

	/**
	 * 将耗时为 0 且依赖已齐的任务记为完成。
	 */
	function completeInstant() {
		for (const task of tasksById.values()) {
			if (task.running || isUnknownRunDuration(task)) continue
			if (!completed.has(taskId(task)) && depsComplete(task) && taskDurationMs(task) === 0)
				completed.add(taskId(task))
		}
	}

	for (const task of tasks) {
		if (!task.running) continue
		if (isUnknownRunDuration(task)) {
			if (task.heavy) exclusiveRunning = true
			else {
				usedMemBytes += task.memMb * MiB
				usedCpuPct += task.cpuPct
			}
			continue
		}
		const duration = taskDurationMs(task)
		if (duration <= 0) {
			completed.add(taskId(task))
			continue
		}
		occupy(task, false, duration)
		checkFreeAt = Math.max(checkFreeAt, task.moduleCheckMs ?? 0)
	}

	while (completed.size < tasks.length) {
		completeInstant()
		tryAdmit()

		if (!running.length) {
			const leftover = [...tasksById.values()].some(task =>
				!completed.has(taskId(task)) && !isUnknownRunDuration(task) && !task.running)
			if (!leftover) break
			completeInstant()
			tryAdmit()
			if (!running.length) break
			continue
		}

		const nextEnd = Math.min(...running.map(slot => slot.endTime))
		time = nextEnd

		for (const slot of [...running]) {
			if (slot.endTime !== nextEnd) continue
			completed.add(slot.id)
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

	const criticalPathCount = depthById.size ? Math.max(...depthById.values()) : 0
	return { makespanMs: time, criticalPathCount }
}

/**
 * 汇总预估：串行累加 vs 并行模拟墙钟与 ETA。
 * @param {EstimateTask[]} tasks 任务列表
 * @param {object} options 选项
 * @param {number} options.memBudgetBytes 内存预算（字节）
 * @param {number} options.cpuBudgetPct CPU 预算（%）
 * @param {boolean} [options.speculative] 是否模拟一层依赖重叠
 * @returns {object} 预估汇总（etaMs 在仅有未知耗时的真跑时为 null）
 */
export function summarizeEstimate(tasks, { memBudgetBytes, cpuBudgetPct, speculative = true }) {
	const serialSum = serialSumMs(tasks)
	const unknownCount = tasks.filter(isUnknownRunDuration).length
	const { makespanMs: parallelMakespanMs, criticalPathCount: parallelGapCount } =
		simulateParallelMakespanMs(tasks, { memBudgetBytes, cpuBudgetPct, speculative })
	const rawEtaMs = estimateEtaMs(parallelMakespanMs, parallelGapCount)
	const etaMs = unknownCount > 0 && parallelMakespanMs === 0 ? null : rawEtaMs
	const savingsMs = Math.max(0, serialSum - parallelMakespanMs)

	return {
		serialSumMs: serialSum,
		parallelMakespanMs,
		chosenMakespanMs: parallelMakespanMs,
		etaMs,
		parallelEtaMs: etaMs,
		unknownCount,
		parallelRatePct: calcParallelRatePct(serialSum, parallelMakespanMs),
		savingsMs,
		gapCount: parallelGapCount,
		parallelGapCount,
		runCount: tasks.filter(task => !task.reused && !task.blocked).length,
		reusedCount: tasks.filter(task => task.reused).length,
		blockedCount: tasks.filter(task => task.blocked).length,
	}
}

/** 低于此阈值的并行节省视为噪声，不展示「并行预估 / 可节省」。 */
export const PARALLEL_SAVINGS_NOISE_MS = 100

/**
 * 串行相对并行是否有值得展示的节省（与 console / report 共用）。
 * @param {{ savingsMs?: number | null }} estimate 预估汇总
 * @returns {boolean} 节省是否超过噪声阈值
 */
export function hasMeaningfulParallelSavings(estimate) {
	return Math.abs(estimate?.savingsMs ?? 0) > PARALLEL_SAVINGS_NOISE_MS
}
