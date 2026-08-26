/**
 * 理想调度计划：给定全局任务集合与资源预算，模拟内核 ResourceRunGate 的调度规则，
 * 产出每个任务的绝对时间槽，供各消费端投影 ETA 与在跑项。
 *
 * 这不再是塞进每个事件里的近似剩余，而是一份由内核维护、随真实状态（队列 / 在跑 /
 * 依赖 / 资源预算）变化而重建的规范时间表。消费端只读取本队列的在跑项与最后一个任务
 * 的预计完成时刻，自行决定是否展示变化及原因。
 */
import { MiB } from '../core/concurrency.mjs'

/**
 * 单个待调度任务（对齐 EstimateTask，另带消费归属字段）。
 * @typedef {object} ScheduleTask
 * @property {string} [id] 实例 id（缺省 = key；重复 suite 不可折叠）
 * @property {string} key suite 键
 * @property {number | null} durationMs 预估全量耗时（毫秒）
 * @property {number} [elapsedMs] 已运行毫秒（在跑项）
 * @property {boolean} [running] 是否已占用资源
 * @property {boolean} [reused] 复用（计 0 耗时）
 * @property {boolean} [blocked] 阻塞（计 0 耗时）
 * @property {number} memMb 内存预算（MB）
 * @property {number} cpuPct CPU 预算（%）
 * @property {boolean} [heavy] heavy 独占
 * @property {number} [moduleCheckMs] 模组检查互斥时长
 * @property {string[]} [deps] 依赖 suite 键
 * @property {string | null} [jobId] 归属 job（fs 项为 null）
 * @property {'cli' | 'fs'} [source] 来源
 */

/**
 * 时间槽（相对现在 t=0，毫秒）。
 * @typedef {object} ScheduleSlot
 * @property {string} id 实例 id
 * @property {string} key suite 键
 * @property {string | null} jobId 归属 job
 * @property {'cli' | 'fs'} [source] 来源
 * @property {number} startAt 开始时刻
 * @property {number | null} endAt 结束时刻（未知耗时为 null）
 * @property {boolean} running 是否在跑
 * @property {boolean} heavy 是否 heavy
 */

/**
 * @param {ScheduleTask} task 任务
 * @returns {number | null} 剩余耗时（复用/blocked 计 0；未知为 null）
 */
function remainingMs(task) {
	if (task.reused || task.blocked) return 0
	if (!Number.isFinite(task.durationMs)) return null
	return Math.max(0, task.durationMs - (task.elapsedMs ?? 0))
}

/**
 * 有效耗时（复用/blocked/未知计 0）。
 * @param {ScheduleTask} task 任务
 * @returns {number} 毫秒
 */
function effectiveMs(task) {
	return remainingMs(task) ?? 0
}

/**
 * @param {ScheduleTask} task 任务
 * @returns {boolean} 是否未知耗时
 */
function isUnknown(task) {
	return remainingMs(task) == null
}

/**
 * 由任务集合与资源预算构造理想时间表。
 * 调度规则与 ResourceRunGate 一致：heavy 独占；light 按 mem×CPU 二维装箱（填缝择优），
 * 空闲必放一个；依赖先完成；模组检查互斥。
 * @param {ScheduleTask[]} tasks 全部任务（队列 + 在跑）
 * @param {object} budget 预算
 * @param {number} budget.memBudgetBytes 内存预算（字节）
 * @param {number} budget.cpuBudgetPct CPU 预算（%）
 * @returns {{ slots: ScheduleSlot[], makespanMs: number, criticalPathCount: number, unknownCount: number }} 时间表
 */
export function buildTimeline(tasks, { memBudgetBytes, cpuBudgetPct }) {
	const byId = new Map()
	const instancesByKey = new Map()
	for (const t of tasks) {
		const id = t.id ?? t.key
		byId.set(id, t)
		let list = instancesByKey.get(t.key)
		if (!list) {
			list = []
			instancesByKey.set(t.key, list)
		}
		list.push(t)
	}

	/** @type {Set<string>} */
	const completed = new Set()
	/** @type {Set<string>} 已执行完、资源已释放，但依赖尚未硬完成 */
	const executed = new Set()
	/** @type {Map<string, number>} */
	const depthById = new Map()
	/** @type {Map<string, number>} */
	const startById = new Map()
	/** @type {Map<string, number | null>} */
	const endById = new Map()

	let time = 0
	let usedMemBytes = 0
	let usedCpuPct = 0
	let exclusiveRunning = false
	let checkFreeAt = 0
	/** @type {{ id: string, key: string, endTime: number, memMb: number, cpuPct: number, heavy: boolean }[]} */
	let running = []

	/** @returns {number} 已完成任务最大代际深度 */
	function maxCompletedDepth() {
		let max = 0
		for (const id of completed)
			max = Math.max(max, depthById.get(id) ?? 0)
		return max
	}

	/**
	 * @param {ScheduleTask} task 任务
	 * @returns {boolean} 依赖是否已完成
	 */
	function depsComplete(task) {
		for (const depKey of task.deps ?? []) {
			const deps = instancesByKey.get(depKey)
			if (!deps?.length) continue
			if (deps.some(dep => isUnknown(dep))) return false
			if (deps.some(dep => !completed.has(dep.id ?? dep.key))) return false
		}
		return true
	}

	/**
	 * @param {ScheduleTask} task 任务
	 * @returns {boolean} 余量是否足够
	 */
	function canFit(task) {
		if (usedMemBytes + task.memMb * MiB > memBudgetBytes) return false
		if (usedCpuPct + task.cpuPct > cpuBudgetPct) return false
		return true
	}

	/**
	 * @param {ScheduleTask} task 任务
	 * @returns {number} 填缝分数
	 */
	function fillScore(task) {
		const memAfter = usedMemBytes + task.memMb * MiB
		const cpuAfter = usedCpuPct + task.cpuPct
		return Math.min(memAfter / memBudgetBytes, cpuAfter / cpuBudgetPct)
	}

	/** @returns {ScheduleTask[]} 硬就绪 */
	function listReady() {
		const runningIds = new Set(running.map(slot => slot.id))
		return [...byId.values()].filter(task =>
			!completed.has(task.id ?? task.key)
			&& !executed.has(task.id ?? task.key)
			&& !runningIds.has(task.id ?? task.key)
			&& !task.running
			&& depsComplete(task)
			&& effectiveMs(task) > 0
			&& !isUnknown(task))
	}

	/**
	 * @param {ScheduleTask} task 任务
	 * @param {number} startTime 开始时刻（可能晚于当前 time，受模块检查互斥窗限制）
	 * @param {number} endTime 结束时刻
	 */
	function occupy(task, startTime, endTime) {
		const id = task.id ?? task.key
		depthById.set(id, maxCompletedDepth() + 1)
		startById.set(id, startTime)
		endById.set(id, endTime)
		if (task.heavy) {
			exclusiveRunning = true
			running.push({ id, key: task.key, endTime, memMb: 0, cpuPct: 0, heavy: true })
			return
		}
		usedMemBytes += task.memMb * MiB
		usedCpuPct += task.cpuPct
		running.push({ id, key: task.key, endTime, memMb: task.memMb, cpuPct: task.cpuPct, heavy: false })
	}

	/**
	 * @param {ScheduleTask} task 任务
	 */
	function admit(task) {
		const spawnAt = Math.max(time, checkFreeAt)
		const checkEnd = spawnAt + (task.moduleCheckMs ?? 0)
		checkFreeAt = checkEnd
		occupy(task, spawnAt, checkEnd + effectiveMs(task))
	}

	/**
	 * @param {ScheduleTask[]} candidates light 候选
	 * @param {boolean} requireFit 是否要求能装进当前余量
	 * @returns {ScheduleTask | null} 选中的任务
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

	/** 在预算内尽量接纳就绪任务。 */
	function tryAdmit() {
		if (exclusiveRunning) return
		const idle = usedMemBytes === 0 && usedCpuPct === 0
		if (idle) {
			const hard = listReady()
			const heavy = hard.find(task => task.heavy)
			if (heavy) {
				admit(heavy)
				return
			}
			const light = hard.filter(task => !task.heavy)
			const start = pickLight(light, true) ?? pickLight(light, false)
			if (start) admit(start)
		}
		for (; ;) {
			const best = pickLight(listReady().filter(task => !task.heavy), true)
			if (!best) break
			admit(best)
		}
	}

	/** 将耗时为 0、或已执行完且依赖已齐的任务记为完成。 */
	function completeInstant() {
		for (const task of byId.values()) {
			if (task.running || isUnknown(task)) continue
			const id = task.id ?? task.key
			if (completed.has(id) || !depsComplete(task)) continue
			if (effectiveMs(task) === 0 || executed.has(id)) {
				completed.add(id)
				startById.set(id, 0)
				endById.set(id, 0)
			}
		}
	}

	// 锚定在跑任务。
	for (const task of tasks) {
		if (!task.running) continue
		const id = task.id ?? task.key
		startById.set(id, 0)
		if (isUnknown(task)) {
			endById.set(id, null)
			if (task.heavy) exclusiveRunning = true
			else {
				usedMemBytes += task.memMb * MiB
				usedCpuPct += task.cpuPct
			}
			checkFreeAt = Math.max(checkFreeAt, task.moduleCheckMs ?? 0)
			continue
		}
		const duration = effectiveMs(task)
		if (duration <= 0) {
			completed.add(id)
			endById.set(id, 0)
			continue
		}
		// 在跑任务还持有检查租约时，剩余检查时长一并计入其完成时刻（检查等待 + 执行）。
		occupy(task, 0, duration + (task.moduleCheckMs ?? 0))
		checkFreeAt = Math.max(checkFreeAt, task.moduleCheckMs ?? 0)
	}

	while (completed.size < byId.size) {
		completeInstant()
		tryAdmit()

		if (!running.length) {
			const leftover = [...byId.values()].some(task =>
				!completed.has(task.id ?? task.key) && !isUnknown(task) && !task.running)
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
			executed.add(slot.id)
			if (slot.heavy) exclusiveRunning = false
			else {
				usedMemBytes -= slot.memMb * MiB
				usedCpuPct -= slot.cpuPct
			}
			const task = byId.get(slot.id)
			if (!task || depsComplete(task)) completed.add(slot.id)
		}
		running = running.filter(slot => slot.endTime !== nextEnd)
		completeInstant()
		tryAdmit()
	}

	const criticalPathCount = depthById.size ? Math.max(...depthById.values()) : 0
	const makespanMs = Math.max(0, ...endById.values().filter(end => end != null))
	const slots = byId.size
		? [...byId.values()].map(task => {
			const id = task.id ?? task.key
			return {
				id,
				key: task.key,
				jobId: task.jobId ?? null,
				source: task.source,
				startAt: startById.get(id) ?? 0,
				endAt: endById.get(id) ?? null,
				running: !!task.running,
				heavy: !!task.heavy,
			}
		})
		: []
	const unknownCount = [...byId.values()].filter(isUnknown).length
	return { slots, makespanMs, criticalPathCount, unknownCount }
}

/**
 * 消费端投影：该 consumer（watch 全局 / 指定 job）的在跑项与其最后一个任务的完成时刻。
 * @param {ScheduleSlot[]} slots 时间表
 * @param {{ watch: boolean, jobId?: string | null }} consumer 消费端
 * @returns {{ running: ScheduleSlot[], lastCompletionAt: number | null, unknownCount: number }} 投影
 */
export function projectConsumer(slots, { watch = false, jobId = null }) {
	/**
	 * @param {ScheduleSlot} slot 槽位
	 * @returns {boolean} 是否归属
	 */
	const belongs = slot => watch || (jobId != null && slot.jobId === jobId)
	const own = slots.filter(belongs)
	const running = own.filter(slot => slot.running)
	const knownEnds = own.map(slot => slot.endAt).filter(end => end != null)
	const lastCompletionAt = knownEnds.length ? Math.max(...knownEnds) : null
	const unknownCount = own.filter(slot => slot.endAt == null).length
	return { running, lastCompletionAt, unknownCount }
}
