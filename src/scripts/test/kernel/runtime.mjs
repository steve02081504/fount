/**
 * 测试内核运行时：队列、调度、skip_because、报告事件。
 */
import { randomUUID } from 'node:crypto'
import { watch } from 'node:fs'

import { CPU_BUDGET_PCT } from '../core/baseline.mjs'
import { getHeadCommitHash } from '../core/changed.mjs'
import { computeGlobalBudget } from '../core/concurrency.mjs'
import { buildEstimateTask, expectedRunDurationMs, summarizeEstimate } from '../core/estimate.mjs'
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
	refreshEntryFingerprint,
	suiteKey,
	suiteTriggeredFiles,
	upsertSuiteRun,
	writeState,
} from '../core/state.mjs'
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
	 */
	constructor({
		repoRoot,
		autoExit = false,
		watchFs = true,
		prepSettleMs = DEFAULT_PREP_SETTLE_MS,
		writeReport = true,
	}) {
		this.repoRoot = repoRoot
		this.autoExit = autoExit
		this.watchFsEnabled = watchFs
		this.writeReport = writeReport
		this.queues = new TestQueues({ prepSettleMs })
		this.moduleCheck = new ModuleCheckGate()
		this.issueCache = new GithubIssueCache()
		this.viewers = new ViewerHub()
		this.globalBudget = computeGlobalBudget()
		this.gate = new ResourceRunGate(
			this.globalBudget.memBytes,
			suite => this.state?.suites[suiteKey(suite.manifestId, suite.name)],
		)
		/** @type {Map<string, object>} */
		this.jobs = new Map()
		/** @type {Map<string, { item: object, abort: AbortController }>} */
		this.running = new Map()
		/** @type {Map<string, boolean>} */
		this.sessionPassed = new Map()
		/** @type {Set<string>} */
		this.sessionSkipped = new Set()
		this.closed = false
		this.seenViewer = false
		this.catalog = null
		this.state = null
		/** @type {RunReportWriter | null} */
		this.report = null
		this.#wake = Promise.withResolvers()
		this.#loop = null
		this.#watcher = null
		/** 内核关闭时回调（由 server 接 HTTP 停机）。 */
		this.onClose = () => {}
	}

	#wake
	#loop
	#watcher

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
		if (this.watchFsEnabled)
			this.#watcher = watch(this.repoRoot, { recursive: true }, (_event, filename) => {
				if (!filename) return
				this.noteFileChange(String(filename).replace(/\\/g, '/'))
			})
		this.#loop = this.#runLoop()
	}

	/**
	 * @returns {Promise<void>}
	 */
	async close() {
		if (this.closed) return
		this.closed = true
		this.#watcher?.close()
		this.wake()
		this.onClose()
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
						...this.#remainingState(),
					})
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
		const prepared = job.prepared
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
				accepted: acceptedFromWave(wave, { runCount: 0, reuseCount: 0, blockedCount: 0, remainingMs: 0 }),
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
		const remaining = this.#remainingFromPlan(wave.plan)
		return {
			runCount,
			activate: true,
			wave,
			accepted: acceptedFromWave(wave, {
				runCount,
				reuseCount,
				blockedCount,
				skippedCount,
				remainingMs: remaining.remainingMs,
				unknownCount: remaining.unknownCount,
			}),
		}
	}

	/**
	 * @param {object} job job
	 * @param {{ wave: object, runCount: number }} prepared 已规划波次
	 * @returns {Promise<void>}
	 */
	async #activateWave(job, prepared) {
		const wave = prepared.wave
		await this.#beginReport(job, wave)
		const imperfectKeys = wave.selection?.imperfectKeys ?? new Set()
		const runSlots = wave.plan.slots.filter(slot => slot.action === 'run')
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
			await this.#reportEnsure(slot.suite, reason)
		}
		for (const slot of wave.plan.slots) 
			if (slot.action === 'reuse') {
				const prev = this.state.suites[slot.key]
				const fp = this.#fingerprintFor(slot.suite, wave.fingerprints)
				const hashes = triggerHashesFromVerdict(wave.verdicts.get(slot.key))
				refreshEntryFingerprint(this.state, slot.key, fp.commitHash, fp.uncommittedHash, hashes.triggerHash, hashes.subtestTriggerHashes)
				await writeState(this.repoRoot, this.state)
				this.sessionPassed.set(slot.key, prev?.status !== 'failed')
				await this.#reportResult(slot.suite, this.state.suites[slot.key], { reused: true })
				this.viewers.broadcast({
					type: 'suite-end',
					key: slot.key,
					jobId: job.id,
					passed: prev?.status !== 'failed',
					reused: true,
					status: prev?.status,
					...this.#remainingState(),
				})
			}
			else if (slot.action === 'blocked') {
				await this.#recordBlocked(slot, wave.fingerprints)
				job.exitCode = 1
				this.viewers.broadcast({
					type: 'suite-end',
					key: slot.key,
					jobId: job.id,
					passed: false,
					blockedBy: slot.blockedBy ?? [],
					...this.#remainingState(),
				})
			}
			else if (slot.action === 'skipped')
				await this.#recordSkipped(slot, job.id)
		
		await this.#flushReportEstimate()
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
	 * @param {object} slot 槽
	 * @param {object} fingerprints 指纹
	 * @returns {Promise<void>}
	 */
	async #recordBlocked(slot, fingerprints) {
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
		await this.#reportResult(slot.suite, this.state.suites[slot.key])
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
		await this.#reportResult(slot.suite, this.state.suites[slot.key] ?? {
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
			...this.#remainingState(),
		})
	}

	/**
	 * @param {import('../core/plan.mjs').RunPlan} plan 计划
	 * @returns {{ remainingMs: number | null, unknownCount: number }} 剩余
	 */
	#remainingFromPlan(plan) {
		const tasks = []
		for (const slot of plan.slots) {
			if (slot.action !== 'run') continue
			const suite = slot.suite
			if (!suite) continue
			tasks.push(buildEstimateTask(suite, this.state.suites[slot.key], {
				id: slot.key,
				subtestsToRun: slot.subtestsToRun,
				moduleCheckMs: this.moduleCheck.meanDurationMs(),
			}))
		}
		return this.#snapshotFromTasks(tasks)
	}

	/**
	 * @returns {import('../core/estimate.mjs').EstimateTask[]} 队列+在跑的预估任务
	 */
	#estimateTasks() {
		const now = Date.now()
		const tasks = []
		for (const item of [...this.queues.cli, ...this.queues.fs]) {
			const suite = this.catalog.byKey.get(item.key)
			if (!suite) continue
			tasks.push(buildEstimateTask(suite, this.state.suites[item.key], {
				id: item.id,
				subtestsToRun: item.subtests,
				moduleCheckMs: this.moduleCheck.meanDurationMs(),
			}))
		}
		for (const [key, running] of this.running) {
			const suite = this.catalog.byKey.get(key)
			if (!suite) continue
			const item = running.item
			const meanCheck = this.moduleCheck.meanDurationMs()
			const checkElapsed = this.moduleCheck.heldTicket ? now - this.moduleCheck.heldAt : 0
			tasks.push(buildEstimateTask(suite, this.state.suites[key], {
				id: item.id ?? `run:${key}`,
				subtestsToRun: item.subtests,
				elapsedMs: now - (running.startedAt ?? now),
				running: true,
				moduleCheckMs: running.checkDone ? 0 : Math.max(0, meanCheck - checkElapsed),
			}))
		}
		return tasks
	}

	/**
	 * @param {import('../core/estimate.mjs').EstimateTask[]} tasks 任务
	 * @returns {{ remainingMs: number | null, unknownCount: number }} 剩余
	 */
	#snapshotFromTasks(tasks) {
		if (!tasks.length) return { remainingMs: 0, unknownCount: 0 }
		const estimate = summarizeEstimate(tasks, {
			memBudgetBytes: this.globalBudget.memBytes,
			cpuBudgetPct: CPU_BUDGET_PCT,
			speculative: false,
		})
		return { remainingMs: estimate.etaMs, unknownCount: estimate.unknownCount }
	}

	/**
	 * @returns {{ remainingMs: number | null, unknownCount: number }} 剩余
	 */
	#remainingState() {
		return this.#snapshotFromTasks(this.#estimateTasks())
	}

	/**
	 * @returns {Promise<void>}
	 */
	async #flushReportEstimate() {
		if (!this.report) return
		const tasks = this.#estimateTasks()
		await this.report.setEstimatePlan(
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
				await this.#recordBlocked({ suite, key: item.key, blockedBy }, job?.fingerprints ?? { commitHash: null, uncommittedHash: null })
			else
				this.sessionPassed.set(item.key, false)
			if (job) job.exitCode = 1
			this.viewers.broadcast({
				type: 'suite-end',
				key: item.key,
				jobId: item.jobId,
				passed: false,
				blockedBy,
				...this.#remainingState(),
			})
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
			const promoted = this.queues.promotePrep()
			for (const item of promoted)
				this.viewers.broadcast({
					type: 'queue-append',
					key: item.key,
					reason: item.reason,
					...this.#remainingState(),
				})
			await this.#discardBlocked()
			await this.#discardSkipped()
			await this.#admitReady()
			if (this.queues.pendingEmpty() && !this.running.size) {
				this.issueCache.pruneOlderThan()
				if (this.jobs.size === 0)
					this.viewers.broadcast({ type: 'idle', remainingMs: 0, unknownCount: 0 })
			}
			if (this.#shouldExit()) {
				this.issueCache.pruneOlderThan()
				await this.close()
				return
			}
			const waitPrep = this.queues.nextPrepWaitMs()
			const waiters = [this.#wake.promise]
			if (waitPrep != null)
				waiters.push(new Promise(resolve => setTimeout(resolve, waitPrep)))
			await Promise.race(waiters)
		}
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
	 * @returns {Promise<void>}
	 */
	async #admitReady() {
		for (;;) {
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
		const key = item.key
		const abort = new AbortController()
		this.running.set(key, { item, abort, startedAt: Date.now(), checkDone: false })
		this.#syncKeepAwake()
		const expectedMs = expectedRunDurationMs(suite, this.state.suites[key], item.subtests)
		this.viewers.broadcast({
			type: 'suite-start',
			key,
			jobId: item.jobId,
			expectedMs,
			...this.#remainingState(),
		})
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
			ticket = suite.run[0] === 'deno' ? await this.moduleCheck.acquire() : null
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
			if (ticket && this.moduleCheck.abandon(ticket)) {
				endEvent = await this.#finishMissedReady(item, suite)
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
			this.sessionPassed.set(key, result.passed)
			await this.#reportResult(suite, this.state.suites[key])
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
						...this.#remainingState(),
					})
			}
			if (endEvent)
				this.viewers.broadcast({ ...endEvent, ...this.#remainingState() })
			if (item.jobId)
				await this.#onJobItemDone(item)
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
		await this.#reportResult(suite, this.state.suites[item.key] ?? {
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
	 * 子进程未发 ready 就退出：记失败并释放闸（调用方已 abandon）。
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
		await this.#reportResult(suite, this.state.suites[item.key])
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
	 * @param {object} job job
	 * @returns {Promise<void>}
	 */
	async #finishJob(job) {
		const finished = await this.#finishReport(job.exitCode)
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
		if (this.report)
			await this.report.finalize(job.exitCode)
		this.report = new RunReportWriter({
			repoRoot: this.repoRoot,
			planSlots: wave.plan.slots,
			runId: randomUUID(),
			command: jobCommand(job.spec),
			commitHash: wave.fingerprints?.commitHash ?? await getHeadCommitHash(this.repoRoot),
			uncommittedHash: wave.fingerprints?.uncommittedHash ?? null,
			continueReasons: wave.continueReasons,
		})
		await this.report.init()
	}

	/**
	 * 收口报告；空波次未开报告则不动磁盘。
	 * @param {number} exitCode 退出码
	 * @returns {Promise<{ reportPath: string | null, allReusedHint: boolean }>} 收口信息
	 */
	async #finishReport(exitCode) {
		if (!this.report) return { reportPath: null, allReusedHint: false }
		const slots = this.report.slots.filter(slot => slot.state === 'done')
		const allReusedHint = exitCode !== 0 && slots.length
			&& slots.every(slot => slot.reused || slot.status === 'blocked')
		const reportPath = (await this.report.finalize(exitCode)).replace(/\\/g, '/')
		this.report = null
		return { reportPath, allReusedHint }
	}

	/**
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {import('../runner/continue_reason.mjs').ContinueReason} [continueReason] 纳入原因
	 * @returns {Promise<void>}
	 */
	async #reportEnsure(suite, continueReason) {
		if (!this.report) return
		await this.report.ensureSlot({
			manifestId: suite.manifestId,
			name: suite.name,
			continueReason,
		})
	}

	/**
	 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
	 * @param {object} entry 现状条目
	 * @param {object} [options] 选项
	 * @returns {Promise<void>}
	 */
	async #reportResult(suite, entry, options) {
		if (!this.report || !entry) return
		await this.report.recordByKey(suite.manifestId, suite.name, entry, options)
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
				...this.#remainingState(),
			})
		}
		for (const [, running] of this.running)
			if (running.item.viewerId === viewerId) {
				const stillWanted = this.queues.cli.some(item => item.key === running.item.key)
				if (!stillWanted) running.abort.abort('viewer_gone')
			}
		for (const job of [...this.jobs.values()])
			if (job.viewerId === viewerId && job.pending.size === 0 && ![...this.running.values()].some(r => r.item.jobId === job.id)) {
				job.done.resolve(job.exitCode)
				this.jobs.delete(job.id)
			}
		this.wake()
	}
}
