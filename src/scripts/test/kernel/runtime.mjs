/**
 * 测试内核运行时：队列、调度、skip_because、报告事件。
 */
import { randomUUID } from 'node:crypto'
import { watch } from 'node:fs'

import { console } from '../../i18n/bare.mjs'
import { ms } from '../../ms.mjs'
import { CPU_BUDGET_PCT } from '../core/baseline.mjs'
import { getHeadCommitHash } from '../core/changed.mjs'
import { CLEANUP_LEAK_EXIT_CODE, findCleanupLeaks } from '../core/cleanup_check.mjs'
import { computeGlobalBudget } from '../core/concurrency.mjs'
import { buildEstimateTask, expectedRunDurationMs } from '../core/estimate.mjs'
import { parseExpectedMs } from '../core/expected.mjs'
import { parseGithubIssueUrl } from '../core/github_issue.mjs'
import { resolveSerialOnlyFiles } from '../core/serial_files.mjs'
import {
	formatSkipBecauseUrls,
	isSkipBecauseBlocking,
	isSkipBecausePass,
	isSkipBecauseSkipTree,
	skipBecauseAction,
	skipBecauseEntriesForRun,
} from '../core/skip_because.mjs'
import {
	readModuleCheckStats,
	refreshEntryFingerprint,
	suiteKey,
	suiteTriggeredFiles,
	upsertSuiteRun,
	writeModuleCheckStats,
	writeState,
} from '../core/state.mjs'
import { applyDriftPatchToManifest, driftedEstimatePatch } from '../core/update_estimates.mjs'
import { GithubIssueCache, probeGithubIssue } from '../hub/apis/github_issue.mjs'
import { formatContinueReasonLabel } from '../runner/continue_reason.mjs'
import { RunReportWriter } from '../runner/report.mjs'
import { ResourceRunGate } from '../runner/scheduler.mjs'
import { runSuite } from '../runner/suite_run.mjs'

import {
	acceptedFromWave,
	changedFilesForRun,
	expandJobWave,
	jobCommand,
	loadKernelCatalog,
	triggerHashesFromVerdict,
} from './jobs.mjs'
import { ModuleCheckGate } from './module_check.mjs'
import { attachGitRoots } from './nested_git.mjs'
import { DEFAULT_PREP_SETTLE_MS, TestQueues } from './queues.mjs'
import { buildTimeline, projectConsumer } from './schedule.mjs'
import { buildScheduleUpdate } from './schedule_event.mjs'
import { ViewerHub } from './viewers.mjs'

/**
 * 路径是否忽略（避免 report/state 自激）。
 * @param {string} rel 仓库相对路径
 * @returns {boolean} 是否忽略
 */
export function ignoreWatchPath(rel) {
	const path = rel.replace(/\\/g, '/')
	if (path === '.git' || path.startsWith('.git/')) return true
	if (path.split('/').includes('node_modules')) return true
	if (path === 'debug_logs' || path.startsWith('debug_logs/')) return true
	if (path === 'data/test' || path.startsWith('data/test/')) return true
	return false
}

/** watch 闲置多久后自动补跑一次 --all（毫秒；默认 2 小时）。 */
export const DEFAULT_IDLE_ALL_MS = ms('2h')

/** 资源预算周期刷新间隔（毫秒）。 */
export const BUDGET_REFRESH_MS = 5000

/** 预算变化触发时间表重建的相对阈值。 */
export const BUDGET_CHANGE_THRESHOLD = 0.10

/**
 * 测试内核。
 */
export class TestKernel {
	/**
	 * @param {object} options 选项
	 * @param {string} options.repoRoot 仓库根
	 * @param {boolean} [options.autoExit] 空闲且无 watch 时退出
	 * @param {boolean} [options.watchFs] 是否监视文件系统
	 * @param {number} [options.prepSettleMs] 预备静置毫秒
	 * @param {boolean} [options.writeReport] 是否写活报告
	 * @param {number} [options.moduleCheckHoldTimeoutMs] 模组检查持有超时
	 * @param {number} [options.idleAllMs] watch 闲置自动补跑 --all 的静置毫秒
	 * @param {boolean} [options.autoUpdateExpected] 跑完是否按漂移自动回写 manifest `expected`
	 */
	constructor({
		repoRoot,
		autoExit = false,
		watchFs = true,
		prepSettleMs = DEFAULT_PREP_SETTLE_MS,
		writeReport = true,
		moduleCheckHoldTimeoutMs,
		idleAllMs = DEFAULT_IDLE_ALL_MS,
		autoUpdateExpected = true,
	}) {
		this.idleAllMs = idleAllMs
		this.autoUpdateExpected = autoUpdateExpected
		/** 运行队列最近一次清空的时间（watch 闲置计时起点）。 */
		this.lastIdleAt = Date.now()
		this.#wasIdle = false
		this.repoRoot = repoRoot
		this.autoExit = autoExit
		this.watchFsEnabled = watchFs
		this.writeReport = writeReport
		this.queues = new TestQueues({ prepSettleMs })
		this.moduleCheck = new ModuleCheckGate({
			...moduleCheckHoldTimeoutMs == null ? {} : { holdTimeoutMs: moduleCheckHoldTimeoutMs },
			onHoldTimeout: this.markModuleCheckDone.bind(this),
			/**
			 * 每次模块检查完成即持久化累计时长，供调度 ETA 跨内核复用。
			 * @param {number} totalMs 累计时长
			 * @param {number} count 次数
			 */
			onUpdate: (totalMs, count) => {
				void writeModuleCheckStats(this.repoRoot, { totalMs, count })
			},
		})
		this.issueCache = new GithubIssueCache()
		this.viewers = new ViewerHub()
		this.globalBudget = computeGlobalBudget()
		this.gate = new ResourceRunGate(
			this.globalBudget.memBytes,
			suite => this.state?.suites[suiteKey(suite.manifestId, suite.name)],
			{
				/**
				 * 占用状态变化 → 重建理想调度并广播 schedule-update。
				 * @returns {void}
				 */
				onChange: () => this.#broadcastSchedule('gate_state_changed'),
			},
		)
		/** 资源预算周期刷新计时器。 */
		this.budgetTimer = null
		/** @type {Map<string, object>} */
		this.jobs = new Map()
		/** @type {Map<string, { item: object, abort: AbortController }>} */
		this.running = new Map()
		/** @type {Map<string, boolean>} */
		this.sessionPassed = new Map()
		/** @type {Set<string>} */
		this.sessionSkipped = new Set()
		this.closed = false
		this.#closeDone = null
		this.seenViewer = false
		this.catalog = null
		this.state = null
		this.#wake = Promise.withResolvers()
		this.#loop = null
		this.#watcher = null
		/** 内核关闭时回调（由 server 接 HTTP 停机）。 */
		this.onClose = () => { }
	}

	#wake
	#loop
	#watcher
	#closeDone
	#wasIdle

	/** 唤醒调度循环。 */
	wake() {
		const current = this.#wake
		this.#wake = Promise.withResolvers()
		current.resolve()
	}

	/**
	 * 加载 catalog。
	 * @returns {Promise<void>}
	 */
	async reloadCatalog() {
		this.catalog = await loadKernelCatalog(this.repoRoot)
		this.state = this.catalog.state
	}

	/**
	 * 启动调度循环与 fs watch。
	 * @returns {Promise<void>}
	 */
	async start() {
		await this.reloadCatalog()
		// 恢复历史模块检查均值，避免调度 ETA 每次从兜底值重新收敛。
		const mc = await readModuleCheckStats(this.repoRoot)
		if (mc.count > 0) {
			this.moduleCheck.durationTotalMs = mc.totalMs
			this.moduleCheck.durationCount = mc.count
		}
		if (this.watchFsEnabled)
			this.#watcher = watch(this.repoRoot, { recursive: true }, (_event, filename) => {
				if (!filename) return
				this.noteFileChange(String(filename).replace(/\\/g, '/'))
			})
		this.budgetTimer = setInterval(() => this.#refreshBudget(), BUDGET_REFRESH_MS)
		this.#loop = this.#runLoop()
	}

	/**
	 * 取消在跑任务并排空队列；调度循环内调用时不等待自身结束。
	 * @returns {Promise<void>}
	 */
	async close() {
		if (this.#closeDone) return this.#closeDone
		this.closed = true
		if (this.budgetTimer) clearInterval(this.budgetTimer)
		this.budgetTimer = null
		this.#watcher?.close()
		this.moduleCheck.close()
		const queued = this.queues.drain()
		const runningItems = [...this.running.values()]
		for (const running of runningItems)
			running.abort?.abort('kernel_shutdown')
		this.wake()
		this.#closeDone = this.#settleClose(queued, runningItems)
		this.onClose()
		return this.#closeDone
	}

	/**
	 * 结算排队项与在跑项的 job，再等在跑收掉。
	 * @param {object[]} queued 关闭时取出的队列项
	 * @param {object[]} runningItems 关闭时的在跑项
	 * @returns {Promise<void>}
	 */
	async #settleClose(queued, runningItems) {
		for (const item of queued)
			if (item.jobId) await this.#onJobItemDone(item)
		await this.#drainRunning()
		for (const running of runningItems)
			if (running.item?.jobId) await this.#onJobItemDone(running.item)
	}

	/**
	 * 等正在跑的 suite 在 abort 后收掉；超时不阻塞关机。
	 * @returns {Promise<void>}
	 */
	async #drainRunning() {
		const deadline = Date.now() + 10_000
		while (this.running.size && Date.now() < deadline)
			await new Promise(resolve => setTimeout(resolve, 50))
	}

	/**
	 * 子进程 ready / 持有超时后，该 suite 不再占用模组检查互斥时长。
	 * 不表示已收到 ready；超时只放互斥，未 ready 信息仍留在闸上。
	 * @param {string} ticket 租约
	 * @returns {void}
	 */
	markModuleCheckDone(ticket) {
		if (!ticket) return
		let changed = false
		for (const running of this.running.values())
			if (running.ticket === ticket && !running.checkDone) {
				running.checkDone = true
				changed = true
			}
		// 模块检查均值已更新 → 立即重建理想调度，让 ETA 随新均值收敛，而非等下一个 suite 启动。
		if (changed) this.#broadcastSchedule('module_check_ready')
	}

	/**
	 * 文件变更入口（自测可直接调）。
	 * @param {string} rel 仓库相对路径
	 * @returns {void}
	 */
	noteFileChange(rel) {
		if (ignoreWatchPath(rel)) return
		if (rel.endsWith('/test/manifest.json') || rel === 'test/manifest.json') {
			void this.#onManifestChange(rel)
			return
		}
		if (!this.catalog) return
		for (const suite of this.catalog.allSuites)
			if (suiteTriggeredFiles(suite, [rel]).length)
				this.queues.hitPrep(suiteKey(suite.manifestId, suite.name), `fs:${rel}`)
		this.wake()
	}

	/**
	 * @param {string} manifestPath 变更的 manifest 路径
	 * @returns {Promise<void>}
	 */
	async #onManifestChange(manifestPath) {
		const before = new Map(this.catalog.allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))
		try {
			await this.reloadCatalog()
		}
		catch (error) {
			this.viewers.broadcast({ type: 'error', reason: 'manifest', path: manifestPath, message: String(error?.message ?? error) })
			return
		}
		await attachGitRoots(this.catalog.allSuites, this.repoRoot)
		const after = new Set(this.catalog.allSuites.map(s => suiteKey(s.manifestId, s.name)))
		for (const key of before.keys())
			if (!after.has(key)) {
				const removed = this.queues.removeKey(key)
				const running = this.running.get(key)
				if (running) running.abort.abort('manifest_removed')
				if (removed.length || running)
					this.viewers.broadcast({
						type: 'queue-remove',
						key,
						reason: 'manifest_removed',
					})
				this.#broadcastSchedule('queue_removed', key)
			}
		this.wake()
	}

	/**
	 * 提交 CLI job。
	 * @param {object} spec job
	 * @param {string} viewerId viewer
	 * @returns {Promise<object>} accepted 字段 + jobId
	 */
	async submitJob(spec, viewerId) {
		this.#cancelIdleAll('new_job')
		const jobId = randomUUID()
		const job = {
			id: jobId,
			viewerId,
			spec,
			pending: new Set(),
			probedSkip: new Set(),
			exitCode: 0,
			done: Promise.withResolvers(),
			released: false,
		}
		this.jobs.set(jobId, job)
		if (spec.debug) job.cleanupBaseline = findCleanupLeaks()
		const prepared = await this.#prepareWave(job)
		job.prepared = prepared
		if (!prepared.activate) {
			job.done.resolve(job.exitCode)
			this.jobs.delete(jobId)
		}
		return {
			jobId,
			...prepared.accepted,
			reportPath: null,
			allReusedHint: false,
			code: prepared.accepted.code ?? job.exitCode,
		}
	}

	/**
	 * accepted 发出后再激活队列，避免 suite-start 抢在计划摘要前。
	 * @param {string} jobId job
	 * @returns {Promise<void>}
	 */
	async releaseJob(jobId) {
		const job = this.jobs.get(jobId)
		if (!job || job.released) return
		job.released = true
		const { prepared } = job
		if (!prepared?.activate) return
		await this.#activateWave(job, prepared)
		this.wake()
	}

	/**
	 * @param {object} job job
	 * @returns {Promise<{ runCount: number, accepted: object, activate: boolean, wave?: object }>} 计划摘要
	 */
	async #prepareWave(job) {
		const wave = await expandJobWave({
			repoRoot: this.repoRoot,
			options: { ...job.spec, probedSkip: job.probedSkip, issueStates: this.issueCache.entries },
			catalog: this.catalog,
		})
		if (wave.error || wave.empty) {
			job.exitCode = wave.code ?? 0
			return {
				runCount: 0,
				activate: false,
				accepted: acceptedFromWave(wave, { runCount: 0, reuseCount: 0, blockedCount: 0 }),
			}
		}
		job.fingerprints = wave.fingerprints
		job.verdicts = wave.verdicts
		job.selection = wave.selection
		job.continueReasons = wave.continueReasons
		let runCount = 0
		let reuseCount = 0
		let blockedCount = 0
		let skippedCount = 0
		for (const slot of wave.plan.slots)
			if (slot.action === 'reuse') reuseCount++
			else if (slot.action === 'blocked') blockedCount++
			else if (slot.action === 'skipped') skippedCount++
			else runCount++
		return {
			runCount,
			activate: true,
			wave,
			accepted: acceptedFromWave(wave, {
				runCount,
				reuseCount,
				blockedCount,
				skippedCount,
			}),
		}
	}

	/**
	 * @param {object} job job
	 * @param {{ wave: object, runCount: number }} prepared 已规划波次
	 * @returns {Promise<void>}
	 */
	async #activateWave(job, prepared) {
		const { wave } = prepared
		await this.#beginReport(job, wave)
		const imperfectKeys = wave.selection?.imperfectKeys ?? new Set()
		const runSlots = wave.plan.slots.filter(slot => slot.action === 'run')
		// 多套件并行（会并发占用系统临时目录）时，全局残留扫描不可靠：置 env 跳过本 kernel 与
		// 所有子进程/内嵌 kernel 的扫描；env 经 childEnv() 透传给 suite 子进程。
		// 串行波次则清除，避免前一个并行 run 的标记污染后续串行 run 的残留检测。
		if (runSlots.length > 1) process.env.FOUNT_TEST_IN_PARALLEL = '1'
		else delete process.env.FOUNT_TEST_IN_PARALLEL
		runSlots.sort((a, b) => Number(imperfectKeys.has(b.key)) - Number(imperfectKeys.has(a.key)))
		for (const slot of runSlots) {
			const reason = wave.continueReasons?.get?.(slot.key)
			const item = this.queues.enqueueCli({
				key: slot.key,
				viewerId: job.viewerId,
				jobId: job.id,
				force: job.spec.force,
				subtests: slot.subtestsToRun,
				fileFilters: slot.fileFilters,
				reason: reason ? formatContinueReasonLabel(reason) : slot.key,
				priority: imperfectKeys.has(slot.key) ? 0 : 1,
				slot,
			})
			job.pending.add(item.id)
			await this.#reportEnsure(job, slot.suite, reason)
		}
		for (const slot of wave.plan.slots)
			if (slot.action === 'reuse') {
				const prev = this.state.suites[slot.key]
				const fp = this.#fingerprintFor(slot.suite, wave.fingerprints)
				const hashes = triggerHashesFromVerdict(wave.verdicts.get(slot.key))
				refreshEntryFingerprint(this.state, slot.key, fp.commitHash, fp.uncommittedHash, hashes.triggerHash, hashes.subtestTriggerHashes)
				await writeState(this.repoRoot, this.state)
				this.sessionPassed.set(slot.key, prev?.status !== 'failed')
				await this.#reportResult(job, slot.suite, this.state.suites[slot.key], { reused: true })
				this.viewers.broadcast({
					type: 'suite-end',
					key: slot.key,
					jobId: job.id,
					passed: prev?.status !== 'failed',
					reused: true,
					status: prev?.status,
				})
			}
			else if (slot.action === 'blocked') {
				await this.#recordBlocked(job, slot, wave.fingerprints)
				job.exitCode = 1
				this.viewers.broadcast({
					type: 'suite-end',
					key: slot.key,
					jobId: job.id,
					passed: false,
					blockedBy: slot.blockedBy ?? [],
				})
			}
			else if (slot.action === 'skipped')
				await this.#recordSkipped(slot, job.id)

		await this.#flushReportEstimate(job)
		this.#broadcastSchedule('initial')
		if (!job.pending.size)
			await this.#finishJob(job)
	}

	/**
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {object} fingerprints 指纹
	 * @returns {{ commitHash: string | null, uncommittedHash: string | null }} 指纹
	 */
	#fingerprintFor(suite, fingerprints) {
		if (suite.gitRoot === null)
			return { commitHash: null, uncommittedHash: null }
		if (suite.gitRoot) {
			const snap = fingerprints?.nested?.get(suite.gitRoot)
			return {
				commitHash: snap?.commitHash ?? null,
				uncommittedHash: snap?.uncommittedHash ?? null,
			}
		}
		return {
			commitHash: fingerprints?.commitHash ?? null,
			uncommittedHash: fingerprints?.uncommittedHash ?? null,
		}
	}

	/**
	 * @param {object} job job
	 * @param {object} slot 槽
	 * @param {object} fingerprints 指纹
	 * @returns {Promise<void>}
	 */
	async #recordBlocked(job, slot, fingerprints) {
		const fp = this.#fingerprintFor(slot.suite, fingerprints)
		await upsertSuiteRun({
			repoRoot: this.repoRoot,
			state: this.state,
			suite: slot.suite,
			result: { passed: false, failedFiles: [], output: '', durationMs: 0 },
			blockedBy: slot.blockedBy ?? [],
			commitHash: fp.commitHash,
			uncommittedHash: fp.uncommittedHash,
		})
		await writeState(this.repoRoot, this.state)
		this.sessionPassed.set(slot.key, false)
		await this.#reportResult(job, slot.suite, this.state.suites[slot.key])
	}

	/**
	 * skip_tree 下游：不写 blocked、不失败。
	 * @param {object} slot 槽
	 * @param {string | undefined} jobId job
	 * @returns {Promise<void>}
	 */
	async #recordSkipped(slot, jobId) {
		const skippedBy = slot.skippedBy ?? []
		this.sessionSkipped.add(slot.key)
		this.sessionPassed.set(slot.key, true)
		await this.#reportResult(this.jobs.get(jobId), slot.suite, this.state.suites[slot.key] ?? {
			status: 'passed',
			durationMs: 0,
			failedFiles: [],
			noiseHits: [],
			logPath: null,
		}, { skippedBy })
		this.viewers.broadcast({
			type: 'suite-end',
			key: slot.key,
			jobId,
			passed: true,
			skippedBy,
		})
	}

	/**
	 * @returns {import('../core/estimate.mjs').EstimateTask[]} 队列+在跑的预估任务（带消费归属）
	 */
	#scheduleTasks() {
		const now = Date.now()
		const tasks = []
		for (const item of [...this.queues.cli, ...this.queues.fs]) {
			const suite = this.catalog.byKey.get(item.key)
			if (!suite) continue
			tasks.push(buildEstimateTask(suite, this.state.suites[item.key], {
				id: item.id,
				subtestsToRun: item.subtests,
				// 只有 Deno 套件会走模块检查互斥窗；其它 run（node/Playwright/true）不计。
				moduleCheckMs: suite.run?.[0] === 'deno' ? this.moduleCheck.meanDurationMs() : 0,
				jobId: item.jobId ?? null,
				source: item.source,
			}))
		}
		for (const [key, running] of this.running) {
			const suite = this.catalog.byKey.get(key)
			if (!suite) continue
			const { item } = running
			const meanCheck = this.moduleCheck.meanDurationMs()
			const checkElapsed = this.moduleCheck.heldTicket ? now - this.moduleCheck.heldAt : 0
			const isDeno = suite.run?.[0] === 'deno'
			tasks.push(buildEstimateTask(suite, this.state.suites[key], {
				id: item.id ?? `run:${key}`,
				subtestsToRun: item.subtests,
				elapsedMs: now - (running.startedAt ?? now),
				running: true,
				moduleCheckMs: !isDeno ? 0 : running.checkDone ? 0 : Math.max(0, meanCheck - checkElapsed),
				jobId: item.jobId ?? null,
				source: item.source,
			}))
		}
		return tasks
	}

	/**
	 * 重建理想时间表并给每个 viewer 投影发送 `schedule-update`。
	 * @param {import('./schedule_event.mjs').ScheduleChangeReason} reason 变化原因
	 * @param {string} [detail] 原因细节
	 * @returns {void}
	 */
	#broadcastSchedule(reason, detail = '') {
		const tasks = this.#scheduleTasks()
		const timeline = tasks.length
			? buildTimeline(tasks, { memBudgetBytes: this.globalBudget.memBytes, cpuBudgetPct: CPU_BUDGET_PCT })
			: null
		for (const viewer of this.viewers.values()) {
			const projection = timeline
				? projectConsumer(timeline.slots, { watch: viewer.watch, jobId: viewer.jobId })
				: { running: [], lastCompletionAt: null, unknownCount: 0 }
			this.viewers.send(viewer.id, buildScheduleUpdate(projection, viewer, reason, detail))
		}
	}

	/**
	 * 周期刷新资源预算；变化超阈值时重建时间表并广播。
	 * @returns {void}
	 */
	#refreshBudget() {
		const next = computeGlobalBudget()
		const prev = this.globalBudget
		const delta = Math.abs(next.memBytes - prev.memBytes) / Math.max(1, prev.memBytes)
		if (delta < BUDGET_CHANGE_THRESHOLD && next.cores === prev.cores) return
		this.globalBudget = next
		// 同步闸门内存预算，使准入决策与 ETA 使用同一份当前预算。
		this.gate.memBudgetBytes = next.memBytes
		this.#broadcastSchedule('resource_budget_changed')
	}

	/**
	 * 其他 job / FS 队列里尚未属于本 job 的调度项数。
	 * @param {string} jobId job
	 * @returns {number} 项数
	 */
	#aheadCount(jobId) {
		let count = 0
		for (const running of this.running.values())
			if (running.item.jobId !== jobId) count++
		for (const item of this.queues.cli)
			if (item.jobId !== jobId) count++
		return count + this.queues.fs.length
	}

	/**
	 * 仍在等开工的 job 推一条排队深度（不点名别人的 suite）。
	 * @returns {void}
	 */
	#notifyJobWaits() {
		const busy = this.running.size + this.queues.cli.length + this.queues.fs.length
		for (const viewer of this.viewers.values()) {
			if (viewer.watch || !viewer.jobId) continue
			const job = this.jobs.get(viewer.jobId)
			if (!job || job.finishing) continue
			if ([...this.running.values()].some(running => running.item.jobId === job.id)) continue
			const waitingMine = Boolean(job.pending.size)
			if (!waitingMine && !(viewer.mode === 'overview' && busy > 0)) continue
			const aheadCount = waitingMine ? this.#aheadCount(job.id) : busy
			if (viewer.lastAheadCount === aheadCount) continue
			viewer.lastAheadCount = aheadCount
			this.viewers.send(viewer.id, {
				type: 'job-wait',
				jobId: viewer.jobId,
				aheadCount,
			})
		}
	}

	/**
	 * @param {object} [job] job
	 * @returns {Promise<void>}
	 */
	async #flushReportEstimate(job) {
		if (!job?.report) return
		const tasks = this.#scheduleTasks()
		await job.report.setEstimatePlan(
			new Map(tasks.map(task => [task.key, task])),
			{ memBudgetBytes: this.globalBudget.memBytes, cpuBudgetPct: CPU_BUDGET_PCT, speculative: false },
		)
	}

	/**
	 * @param {string} depKey 依赖 suite 键
	 * @returns {boolean} 仍在跑或仍在队列
	 */
	#depInFlight(depKey) {
		if (this.running.has(depKey) && !this.sessionPassed.has(depKey)) return true
		return this.queues.cli.some(item => item.key === depKey) || this.queues.fs.some(item => item.key === depKey)
	}

	/**
	 * @param {import('./queues.mjs').QueueItem} item 项
	 * @returns {{ failed: string[], skipped: string[] }} 未满足的依赖
	 */
	#unmetDeps(item) {
		const suite = this.catalog.byKey.get(item.key)
		if (!suite) return { failed: [], skipped: [] }
		/** @type {string[]} */
		const failed = []
		/** @type {string[]} */
		const skipped = []
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (this.#depInFlight(depKey)) continue
			const depSuite = this.catalog.byKey.get(depKey)
			const passed = this.sessionPassed.get(depKey)
			if (this.sessionSkipped.has(depKey) || (isSkipBecauseSkipTree(depSuite) && passed !== false)) {
				skipped.push(depKey)
				continue
			}
			if (passed === true) continue
			if (passed === false) {
				failed.push(depKey)
				continue
			}
			if (isSkipBecausePass(depSuite)) continue
			const entry = this.state.suites[depKey]
			if (entry && (entry.status === 'failed' || entry.status === 'blocked'))
				failed.push(depKey)
		}
		return { failed, skipped }
	}

	/**
	 * @param {import('./queues.mjs').QueueItem} item 项
	 * @returns {string[]} 已失败/已阻塞且不在飞行中的依赖
	 */
	#failedDeps(item) {
		return this.#unmetDeps(item).failed
	}

	/**
	 * @param {import('./queues.mjs').QueueItem} item 项
	 * @returns {boolean} 硬就绪
	 */
	#isHardReady(item) {
		const suite = this.catalog.byKey.get(item.key)
		if (!suite) return false
		if (this.running.has(item.key)) return false
		const unmet = this.#unmetDeps(item)
		if (unmet.failed.length || unmet.skipped.length) return false
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (this.#depInFlight(depKey) && this.sessionPassed.get(depKey) !== true)
				return false
		}
		return true
	}

	/**
	 * 依赖已失败的排队项记为 blocked，避免永远占着 job.pending。
	 * @returns {Promise<void>}
	 */
	async #discardBlocked() {
		for (; ;) {
			const queued = [...this.queues.cli, ...this.queues.fs]
			let item
			/** @type {string[] | undefined} */
			let blockedBy
			for (const candidate of queued) {
				const failed = this.#failedDeps(candidate)
				if (!failed.length) continue
				item = candidate
				blockedBy = failed
				break
			}
			if (!item) return
			const removed = this.queues.removeKey(item.key)
			const suite = this.catalog.byKey.get(item.key)
			const job = item.jobId ? this.jobs.get(item.jobId) : undefined
			if (suite)
				await this.#recordBlocked(job, { suite, key: item.key, blockedBy }, job?.fingerprints ?? { commitHash: null, uncommittedHash: null })
			else
				this.sessionPassed.set(item.key, false)
			if (job) job.exitCode = 1
			this.viewers.broadcast({
				type: 'suite-end',
				key: item.key,
				jobId: item.jobId,
				passed: false,
				blockedBy,
			})
			this.#broadcastSchedule('blocked', item.key)
			for (const gone of removed)
				if (gone.jobId)
					await this.#onJobItemDone(gone)
		}
	}

	/**
	 * skip_tree 未满足的排队项记为 skipped，不失败。
	 * @returns {Promise<void>}
	 */
	async #discardSkipped() {
		for (; ;) {
			const queued = [...this.queues.cli, ...this.queues.fs]
			let item
			/** @type {string[] | undefined} */
			let skippedBy
			for (const candidate of queued) {
				const unmet = this.#unmetDeps(candidate)
				if (unmet.failed.length || !unmet.skipped.length) continue
				item = candidate
				skippedBy = unmet.skipped
				break
			}
			if (!item) return
			const removed = this.queues.removeKey(item.key)
			const suite = this.catalog.byKey.get(item.key)
			if (suite)
				await this.#recordSkipped({ suite, key: item.key, skippedBy }, item.jobId)
			else {
				this.sessionSkipped.add(item.key)
				this.sessionPassed.set(item.key, true)
			}
			this.#broadcastSchedule('skipped', item.key)
			for (const gone of removed)
				if (gone.jobId)
					await this.#onJobItemDone(gone)
		}
	}

	/**
	 * @returns {Promise<void>}
	 */
	async #runLoop() {
		while (!this.closed) {
			// watch 闲置计时从运行队列清空这一刻起算（不是从改动或内核启动）。
			if (this.queues.allEmpty() && this.running.size === 0) {
				if (!this.#wasIdle) this.lastIdleAt = Date.now()
				this.#wasIdle = true
			}
			else
				this.#wasIdle = false
			const promoted = this.queues.promotePrep()
			for (const item of promoted)
				this.viewers.broadcast({
					type: 'queue-append',
					key: item.key,
					reason: item.reason,
				})
			if (promoted.length)
				this.#broadcastSchedule('prep_promoted')
			await this.#discardBlocked()
			await this.#discardSkipped()
			if (promoted.length)
				this.#notifyJobWaits()
			await this.#admitReady()
			this.#notifyJobWaits()
			// 闲置满窗口时把全部套件入队；紧随其后的 ready 短路会重入本轮并调度它们。
			this.#maybeFireIdleAll()
			// `#admitReady` is async: even a sync body yields once. A job enqueued in
			// that gap would otherwise miss this tick and sleep until an unrelated wake.
			if (
				this.queues.peekReady(item => this.#isHardReady(item))
				&& this.gate.usedMemBytes === 0
				&& this.gate.usedCpuPct === 0
				&& !this.gate.exclusiveRunning
			)
				continue
			if (this.queues.pendingEmpty() && !this.running.size) {
				this.issueCache.pruneOlderThan()
				if (this.jobs.size === 0)
					this.viewers.broadcast({ type: 'idle' })
			}
			if (this.#shouldExit()) {
				this.issueCache.pruneOlderThan()
				await this.close()
				break
			}
			const waitPrep = this.queues.nextPrepWaitMs()
			const idleAllDueAt = this.#idleAllDueAt()
			const waiters = [this.#wake.promise]
			if (waitPrep != null)
				waiters.push(new Promise(resolve => setTimeout(resolve, waitPrep)))
			if (idleAllDueAt != null)
				waiters.push(new Promise(resolve => setTimeout(resolve, Math.max(0, idleAllDueAt - Date.now()))))
			await Promise.race(waiters)
		}
		await this.#drainRunning()
	}

	/**
	 * 距自动补跑 --all 的到期时刻；不适用（无 watch / 仍在跑）则为 null。
	 * @returns {number | null} 到期时刻（ms）
	 */
	#idleAllDueAt() {
		if (this.viewers.watchCount() === 0) return null
		if (this.catalog.allSuites.length === 0) return null
		if (this.jobs.size > 0 || !this.queues.allEmpty() || this.running.size > 0) return null
		return this.lastIdleAt + this.idleAllMs
	}

	/**
	 * watch 闲置满窗口后把全部套件直接塞进运行队列（等价一次 --all）。
	 * 只入队、不走 expandJobWave 的 git/exec 选择管线；跑完队列清空后计时自动重置。
	 * @returns {void}
	 */
	#maybeFireIdleAll() {
		const dueAt = this.#idleAllDueAt()
		if (dueAt == null || Date.now() < dueAt) return
		for (const suite of this.catalog.allSuites)
			this.queues.enqueueFs(suiteKey(suite.manifestId, suite.name), 'idle_all')
		for (const suite of this.catalog.allSuites) {
			const key = suiteKey(suite.manifestId, suite.name)
			this.viewers.broadcast({ type: 'queue-append', key, reason: 'idle_all' })
		}
		this.#broadcastSchedule('queue_appended')
		this.wake()
	}

	/**
	 * 新任务提交时抢占进行中的 idle_all：清空未开始的 idle_all 队列项，并中止正在跑的 idle_all。
	 * 中止后重置闲置计时，避免刚取消又立即重触发。
	 * @param {string} reason 抢占原因
	 * @returns {void}
	 */
	#cancelIdleAll(reason = 'new_job') {
		const removed = this.queues.removeIdleAll()
		const runningIdle = [...this.running]
			.filter(([, running]) => running.item?.reason === 'idle_all' && !running.item?.jobId)
		if (!removed.length && !runningIdle.length) return
		for (const item of removed)
			this.viewers.broadcast({
				type: 'queue-remove',
				key: item.key,
				reason,
			})
		this.#broadcastSchedule('queue_removed', reason)
		for (const [, running] of runningIdle)
			running.abort?.abort(reason)
		this.lastIdleAt = Date.now()
		this.#wasIdle = false
		this.wake()
	}

	/**
	 * @returns {boolean} 是否该退出
	 */
	#shouldExit() {
		return this.autoExit
			&& this.seenViewer
			&& this.queues.pendingEmpty()
			&& this.running.size === 0
			&& this.viewers.size() === 0
			&& this.jobs.size === 0
	}

	/**
	 * 当前是否有 debug job 在跑（单步串行：任一一套在跑时不再放行）。
	 * @returns {boolean} 是否处于 debug 串行
	 */
	#debugSerialActive() {
		for (const job of this.jobs.values())
			if (job.spec?.debug) return true
		return false
	}

	/**
	 * 放行就绪的 suite 进入运行（debug 串行下暂停）。
	 * @returns {Promise<void>}
	 */
	async #admitReady() {
		for (; ;) {
			const debugSerial = this.#debugSerialActive()
			if (debugSerial && this.running.size > 0) break
			const picked = this.queues.peekReady(item => this.#isHardReady(item))
			if (!picked) break
			const suite = this.catalog.byKey.get(picked.item.key)
			if (!suite) {
				this.queues.dequeue(picked)
				continue
			}
			let release = this.gate.tryAcquire(suite)
			if (!release) {
				const idle = this.gate.usedMemBytes === 0 && this.gate.usedCpuPct === 0 && !this.gate.exclusiveRunning
				if (!idle) break
				release = await this.gate.acquire(suite)
			}
			const item = this.queues.dequeue(picked)
			if (!item) {
				release()
				continue
			}
			void this.#runItem(item, suite, release)
		}
	}

	/**
	 * @param {object} item 队列项
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {() => void} release 资源释放
	 * @returns {Promise<void>}
	 */
	async #runItem(item, suite, release) {
		const { key } = item
		const abort = new AbortController()
		this.running.set(key, { item, abort, startedAt: Date.now(), checkDone: false })
		this.#syncKeepAwake()
		const expectedMs = expectedRunDurationMs(suite, this.state.suites[key], item.subtests)
		this.viewers.broadcast({
			type: 'suite-start',
			key,
			jobId: item.jobId,
			expectedMs,
		})
		this.#broadcastSchedule('suite_started', key)
		this.#notifyJobWaits()
		/** @type {object | null} */
		let endEvent = null
		/** @type {string | null} */
		let ticket = null
		try {
			const skip = await this.#evalSkip(suite, item.subtests)
			if (skip) {
				endEvent = await this.#finishSkip(item, suite, skip)
				return
			}
			const job = this.jobs.get(item.jobId)
			const fingerprints = job?.fingerprints ?? {
				commitHash: await getHeadCommitHash(this.repoRoot),
				uncommittedHash: null,
			}
			const fp = this.#fingerprintFor(suite, fingerprints)
			ticket = suite.run[0] === 'deno' ? await this.moduleCheck.acquire(abort.signal) : null
			const runningHold = this.running.get(key)
			if (runningHold) runningHold.ticket = ticket
			const result = await runSuite(
				suite,
				{
					subtests: item.subtests,
					onlyFiles: item.fileFilters?.length
						? resolveSerialOnlyFiles(suite, item.fileFilters, this.repoRoot).files
						: undefined,
					moduleCheckTicket: ticket,
					triggeredFiles: suiteTriggeredFiles(suite, changedFilesForRun(fingerprints, key)),
				},
				this.globalBudget,
				false,
				{
					label: key,
					baselineDurationMs: expectedMs,
					signal: abort.signal,
					onStdout: this.#broadcastLog.bind(this, key, item.jobId, 'stdout'),
					onStderr: this.#broadcastLog.bind(this, key, item.jobId, 'stderr'),
				},
			)
			if (ticket && this.moduleCheck.consumeMissedReady(ticket)) {
				endEvent = await this.#finishMissedReady(item, suite)
				return
			}
			// 被新任务抢占的 idle_all：视为未运行而非失败——不写失败状态、不改 sessionPassed、不广播失败 suite-end。
			if (result.terminated && result.terminateReason === 'new_job') {
				endEvent = {
					type: 'suite-end',
					key,
					jobId: item.jobId,
					passed: true,
					reused: true,
				}
				return
			}
			const running = this.running.get(key)
			if (running) running.checkDone = true
			const hashes = triggerHashesFromVerdict(job?.verdicts?.get(key))
			await upsertSuiteRun({
				repoRoot: this.repoRoot,
				state: this.state,
				suite,
				result,
				commitHash: fp.commitHash,
				uncommittedHash: fp.uncommittedHash,
				triggerHash: hashes.triggerHash,
				ranSubtests: item.subtests,
				subtestTriggerHashes: hashes.subtestTriggerHashes,
			})
			await writeState(this.repoRoot, this.state)
			if (this.autoUpdateExpected)
				await this.#autoUpdateExpected(suite, this.state.suites[key])
			this.sessionPassed.set(key, result.passed)
			await this.#reportResult(job, suite, this.state.suites[key])
			if (!result.passed && job) job.exitCode = 1
			endEvent = this.#withSuiteLog({
				type: 'suite-end',
				key,
				jobId: item.jobId,
				passed: result.passed,
				durationMs: result.durationMs,
			}, result, this.state.suites[key])
		}
		catch (error) {
			if (ticket && this.moduleCheck.consumeMissedReady(ticket)) {
				endEvent = await this.#finishMissedReady(item, suite)
				return
			}
			const job = item.jobId ? this.jobs.get(item.jobId) : undefined
			if (job) job.exitCode = 1
			this.sessionPassed.set(key, false)
			endEvent = {
				type: 'suite-end',
				key,
				jobId: item.jobId,
				passed: false,
				output: String(error?.stack ?? error),
			}
		}
		finally {
			if (ticket) this.moduleCheck.abandon(ticket)
			this.running.delete(key)
			this.#syncKeepAwake()
			release()
			if (item.source === 'cli') {
				const removedFs = this.queues.completeCli(key)
				for (const fsItem of removedFs)
					this.viewers.broadcast({
						type: 'queue-remove',
						key: fsItem.key,
						reason: 'cli_complete',
					})
			}
			if (endEvent)
				this.viewers.broadcast(endEvent)
			this.#broadcastSchedule(endEvent?.passed === false ? 'suite_failed' : 'suite_completed', key)
			if (item.jobId) {
				const job = this.jobs.get(item.jobId)
				if (job?.spec?.debug)
					await this.#checkCleanupLeak(job, { stopJob: true })
				await this.#onJobItemDone(item)
			}
			this.wake()
		}
	}

	/**
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {string[] | undefined} subtests 子测试
	 * @returns {Promise<{ action: 'pass' | 'fail', urls: string[], closed: string[] } | null>} skip
	 */
	async #evalSkip(suite, subtests) {
		const entries = skipBecauseEntriesForRun(suite, subtests)
		if (!entries?.length) return null
		const urls = entries.map(entry => entry.url)
		/** @type {string[]} */
		const closed = []
		for (const entry of entries) {
			const parsed = parseGithubIssueUrl(entry.url)
			const state = await this.issueCache.getState(
				entry.url,
				() => parsed ? probeGithubIssue(parsed) : Promise.resolve({ closed: false, closedAt: null }),
			)
			if (isSkipBecauseBlocking(state, entry.delayMs))
				closed.push(entry.url)
		}
		return { action: skipBecauseAction(closed), urls, closed }
	}

	/**
	 * @param {object} item 项
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {{ action: 'pass' | 'fail', urls: string[], closed: string[] }} skip skip
	 * @returns {Promise<void>}
	 */
	async #finishSkip(item, suite, skip) {
		const passed = skip.action === 'pass'
		const prev = this.state.suites[item.key]
		const job = item.jobId ? this.jobs.get(item.jobId) : undefined
		job?.probedSkip?.add(item.key)
		if (!passed) {
			await upsertSuiteRun({
				repoRoot: this.repoRoot,
				state: this.state,
				suite,
				result: {
					passed: false,
					failedFiles: [],
					output: `skip_because closed ${formatSkipBecauseUrls(skip.closed)}`,
					durationMs: 0,
				},
				commitHash: prev?.commitHash ?? null,
				uncommittedHash: prev?.uncommittedHash ?? null,
				recordBaseline: false,
			})
			await writeState(this.repoRoot, this.state)
			if (job) job.exitCode = 1
		}
		this.sessionPassed.set(item.key, passed)
		await this.#reportResult(job, suite, this.state.suites[item.key] ?? {
			status: passed ? 'passed' : 'failed',
			durationMs: 0,
			failedFiles: [],
			noiseHits: [],
			logPath: null,
		}, { skipBecause: skip.urls, skipBecauseClosed: skip.closed })
		return this.#withSuiteLog({
			type: 'suite-end',
			key: item.key,
			jobId: item.jobId,
			passed,
			skipBecause: skip.urls,
			skipBecauseClosed: skip.closed,
			durationMs: 0,
		}, passed ? null : { output: `skip_because closed ${formatSkipBecauseUrls(skip.closed)}` }, this.state.suites[item.key])
	}

	/**
	 * 子进程未发 ready 就退出：记失败并释放闸（调用方已 consumeMissedReady）。
	 * @param {object} item 项
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @returns {Promise<object>} suite-end 事件
	 */
	async #finishMissedReady(item, suite) {
		const prev = this.state.suites[item.key]
		const job = item.jobId ? this.jobs.get(item.jobId) : undefined
		await upsertSuiteRun({
			repoRoot: this.repoRoot,
			state: this.state,
			suite,
			result: {
				passed: false,
				failedFiles: [],
				output: 'module-check missed ready',
				durationMs: 0,
			},
			commitHash: prev?.commitHash ?? null,
			uncommittedHash: prev?.uncommittedHash ?? null,
			recordBaseline: false,
		})
		await writeState(this.repoRoot, this.state)
		if (job) job.exitCode = 1
		this.sessionPassed.set(item.key, false)
		await this.#reportResult(job, suite, this.state.suites[item.key])
		return this.#withSuiteLog({
			type: 'suite-end',
			key: item.key,
			jobId: item.jobId,
			passed: false,
			missedReady: true,
			durationMs: 0,
		}, { output: 'module-check missed ready' }, this.state.suites[item.key])
	}

	/**
	 * @param {object} item 项
	 * @returns {Promise<void>}
	 */
	async #onJobItemDone(item) {
		const job = this.jobs.get(item.jobId)
		if (!job) return
		job.pending.delete(item.id)
		if (job.pending.size) return
		await this.#finishJob(job)
	}

	/**
	 * 检查并处理残留物；发现残留时置 job 退出码并广播 cleanup-leak。
	 * @param {object} job job
	 * @param {object} [options] 选项
	 * @param {boolean} [options.stopJob] 是否随后丢弃该 job 其余待跑（debug 单步）
	 * @returns {Promise<boolean>} 是否发现残留
	 */
	async #checkCleanupLeak(job, { stopJob = false } = {}) {
		const leaks = findCleanupLeaks(job.cleanupBaseline)
		if (!leaks.length) return false
		job.exitCode = CLEANUP_LEAK_EXIT_CODE
		this.viewers.broadcast({ type: 'cleanup-leak', jobId: job.id, leaks })
		if (!stopJob) return true
		// debug 单步：丢弃该 job 其余待跑项并取消在跑项。
		for (const item of this.queues.removeJob(job.id)) {
			job.pending.delete(item.id)
			this.viewers.broadcast({
				type: 'queue-remove',
				key: item.key,
				reason: 'cleanup_leak',
			})
		}
		this.#broadcastSchedule('queue_removed', 'cleanup_leak')
		for (const [key, running] of this.running)
			if (running.item.jobId === job.id)
				running.abort.abort('cleanup_leak')
		this.wake()
		return true
	}

	/**
	 * @param {object} job job
	 * @returns {Promise<void>}
	 */
	async #finishJob(job) {
		if (job.finishing) return
		job.finishing = true
		// 残留扫描只在可靠时运行：串行（无其它在跑套件）且本 run 非并行聚合
		// （并行时其它套件可能正写入临时目录，且该 env 会传给子进程/内嵌 kernel）。
		if (!job.spec?.debug && this.running.size === 0 && process.env.FOUNT_TEST_IN_PARALLEL !== '1')
			await this.#checkCleanupLeak(job, { stopJob: false })
		const finished = await this.#finishReport(job)
		job.done.resolve(job.exitCode)
		this.viewers.broadcast({
			type: 'job-done',
			jobId: job.id,
			exitCode: job.exitCode,
			...finished,
		})
		this.jobs.delete(job.id)
		this.wake()
	}

	/**
	 * 套件跑完后若 manifest `expected` 与现状基线漂移超过阈值，回写 manifest 并同步内存。
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {import('../core/state.mjs').SuiteStateEntry} entry 现状条目
	 * @returns {Promise<void>}
	 */
	async #autoUpdateExpected(suite, entry) {
		try {
			const patch = driftedEstimatePatch(suite, entry)
			if (!patch) return
			if (!await applyDriftPatchToManifest(this.repoRoot, suite, patch)) return
			const def = this.catalog.byKey.get(suiteKey(suite.manifestId, suite.name))
			if (!def) return
			if (patch.expected != null) {
				const parsed = parseExpectedMs(patch.expected)
				if (parsed != null) def.expectedMs = parsed
			}
			for (const [name, value] of Object.entries(patch.subtests ?? {})) {
				const parsed = parseExpectedMs(value)
				if (parsed == null) continue
				const subtest = def.subtests?.find(st => st.name === name)
				if (subtest) subtest.expectedMs = parsed
			}
			this.viewers.broadcast({ type: 'expected-drift', key: suiteKey(suite.manifestId, suite.name) })
			this.#broadcastSchedule('expected_drift', suiteKey(suite.manifestId, suite.name))
		}
		catch (error) {
			console.warn(`expected-drift update failed for ${suiteKey(suite.manifestId, suite.name)}: ${String(error?.message ?? error)}`)
		}
	}

	/**
	 * 有 suite 在跑时持有 keep-awake；空闲释放。
	 * @returns {void}
	 */
	#syncKeepAwake() {
		void import('./keep_awake.mjs').then(({ setTestKeepAwake }) => {
			setTestKeepAwake(this.running.size > 0)
		})
	}

	/**
	 * 等调度循环结束（供进程入口）。
	 * @returns {Promise<void>}
	 */
	waitClosed() {
		return this.#loop ?? Promise.resolve()
	}

	/**
	 * 当前测试运行状态快照（供 debug_info 等外部查询）。
	 * @returns {{ active: boolean, idle: boolean, runningSuites: { key: string, elapsedMs: number }[], queuedSuites: string[] }} 状态
	 */
	statusSnapshot() {
		const now = Date.now()
		const runningSuites = [...this.running].map(([key, running]) => ({
			key,
			elapsedMs: now - (running.startedAt ?? now),
		}))
		const queuedSuites = [
			...this.queues.cli.map(item => item.key),
			...this.queues.fs.map(item => item.key),
			...this.queues.prep.keys(),
		]
		const active = runningSuites.length > 0 || queuedSuites.length > 0
		return { active, idle: !active, runningSuites, queuedSuites }
	}

	/**
	 * 把失败/噪声输出挂到 suite-end，供 overview 回放。
	 * @param {object} event suite-end
	 * @param {{ output?: string } | null | undefined} result 子进程结果
	 * @param {{ noiseHits?: string[] } | null | undefined} entry state 条目
	 * @returns {object} event
	 */
	#withSuiteLog(event, result, entry) {
		const noiseHits = entry?.noiseHits ?? []
		if (noiseHits.length) event.noiseHits = noiseHits
		if (!event.passed || noiseHits.length)
			event.output = result?.output ?? ''
		return event
	}

	/**
	 * 把 suite 日志片段广播给 viewer。
	 * @param {string} key suite 键
	 * @param {string | undefined} jobId job
	 * @param {'stdout' | 'stderr'} stream 通道
	 * @param {string} chunk 片段
	 * @returns {void}
	 */
	#broadcastLog(key, jobId, stream, chunk) {
		this.viewers.broadcast({ type: 'log', key, jobId, stream, chunk })
	}

	/**
	 * 有真跑/复用/阻塞槽时开一份活报告（覆盖上次波次）。
	 * @param {object} job job
	 * @param {object} wave 波次
	 * @returns {Promise<void>}
	 */
	async #beginReport(job, wave) {
		if (!this.writeReport) return
		if (job.report)
			await job.report.finalize(job.exitCode)
		job.report = new RunReportWriter({
			repoRoot: this.repoRoot,
			planSlots: wave.plan.slots,
			runId: randomUUID(),
			command: jobCommand(job.spec),
			commitHash: wave.fingerprints?.commitHash ?? await getHeadCommitHash(this.repoRoot),
			uncommittedHash: wave.fingerprints?.uncommittedHash ?? null,
			continueReasons: wave.continueReasons,
		})
		await job.report.init()
	}

	/**
	 * 收口报告；空波次未开报告则不动磁盘。
	 * @param {object} job job
	 * @returns {Promise<{ reportPath: string | null, allReusedHint: boolean }>} 收口信息
	 */
	async #finishReport(job) {
		const { report } = job
		if (!report) return { reportPath: null, allReusedHint: false }
		const slots = report.slots.filter(slot => slot.state === 'done')
		const allReusedHint = job.exitCode !== 0 && slots.length > 0
			&& slots.every(slot => slot.reused || slot.status === 'blocked')
		const reportPath = (await report.finalize(job.exitCode)).replace(/\\/g, '/')
		job.report = null
		return { reportPath, allReusedHint }
	}

	/**
	 * @param {object} job job
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {import('../runner/continue_reason.mjs').ContinueReason} [continueReason] 纳入原因
	 * @returns {Promise<void>}
	 */
	async #reportEnsure(job, suite, continueReason) {
		if (!job?.report) return
		await job.report.ensureSlot({
			manifestId: suite.manifestId,
			name: suite.name,
			continueReason,
		})
	}

	/**
	 * @param {object | undefined} job job
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {object} entry 现状条目
	 * @param {object} [options] 选项
	 * @returns {Promise<void>}
	 */
	async #reportResult(job, suite, entry, options) {
		if (!job?.report || !entry) return
		await job.report.recordByKey(suite.manifestId, suite.name, entry, options)
	}

	/**
	 * viewer 断开：移走其 CLI 项并可能取消在跑。
	 * @param {string} viewerId viewer
	 * @returns {void}
	 */
	dropViewer(viewerId) {
		const removed = this.queues.removeViewer(viewerId)
		for (const item of removed) {
			const job = item.jobId && this.jobs.get(item.jobId)
			if (job) job.pending.delete(item.id)
			this.viewers.broadcast({
				type: 'queue-remove',
				key: item.key,
				reason: 'viewer_gone',
			})
		}
		this.#broadcastSchedule('queue_removed', 'viewer_gone')
		for (const [, running] of this.running)
			if (running.item.viewerId === viewerId) {
				const stillWanted = this.queues.cli.some(item => item.key === running.item.key)
				if (!stillWanted) running.abort.abort('viewer_gone')
			}
		for (const job of [...this.jobs.values()])
			if (job.viewerId === viewerId && job.pending.size === 0 && ![...this.running.values()].some(running => running.item.jobId === job.id))
				void this.#finishJob(job)
		this.wake()
	}
}
