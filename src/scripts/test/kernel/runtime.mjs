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
import { formatSkipBecauseUrls, skipBecauseAction, skipBecauseUrlsForRun } from '../core/skip_because.mjs'
import {
	refreshEntryFingerprint,
	suiteKey,
	suiteTriggeredFiles,
	upsertSuiteRun,
	writeState,
} from '../core/state.mjs'
import { GithubIssueCache, probeGithubIssueClosed } from '../hub/apis/github_issue.mjs'
import { RunReportWriter } from '../runner/report.mjs'
import { ResourceRunGate } from '../runner/scheduler.mjs'
import { runSuite } from '../runner/suite_run.mjs'

import { expandJobWave, loadKernelCatalog } from './jobs.mjs'
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
		if (this.writeReport) {
			this.report = new RunReportWriter({
				repoRoot: this.repoRoot,
				planSlots: [],
				runId: randomUUID(),
				command: 'fount test',
				commitHash: await getHeadCommitHash(this.repoRoot),
				uncommittedHash: null,
			})
			await this.report.init()
		}
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
		const path = rel.replace(/\\/g, '/')
		if (ignoreWatchPath(path)) return
		if (path.endsWith('/test/manifest.json') || path === 'test/manifest.json') {
			void this.#onManifestChange(path)
			return
		}
		if (!this.catalog) return
		for (const suite of this.catalog.allSuites) {
			const files = [path]
			if (suiteTriggeredFiles(suite, files).length)
				this.queues.hitPrep(suiteKey(suite.manifestId, suite.name), `fs:${path}`)
		}
		this.wake()
	}

	/**
	 * @param {string} _path 变更的 manifest 路径
	 * @returns {Promise<void>}
	 */
	async #onManifestChange(_path) {
		const before = new Map(this.catalog.allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))
		try {
			await this.reloadCatalog()
		}
		catch (error) {
			this.viewers.broadcast({ type: 'error', reason: 'manifest', path: _path, message: String(error?.message ?? error) })
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
						remainingMs: this.#remainingMs(),
					})
			}
		this.wake()
	}

	/**
	 * 提交 CLI job。
	 * @param {object} spec job
	 * @param {string} viewerId viewer
	 * @returns {Promise<{ jobId: string, runCount: number, code?: number }>} 结果
	 */
	async submitJob(spec, viewerId) {
		const jobId = randomUUID()
		const job = {
			id: jobId,
			viewerId,
			spec,
			pending: new Set(),
			probedSkip: new Set(),
			continueLoop: !spec.runAll && !spec.groups?.some(g => g.suiteSelectors?.length),
			exitCode: 0,
			done: Promise.withResolvers(),
		}
		this.jobs.set(jobId, job)
		const runCount = await this.#enqueueWave(job)
		if (runCount === 0 && job.pending.size === 0) {
			job.done.resolve(job.exitCode)
			this.jobs.delete(jobId)
		}
		this.wake()
		return { jobId, runCount, code: runCount === 0 ? job.exitCode : undefined }
	}

	/**
	 * @param {object} job job
	 * @returns {Promise<number>} 真跑槽位数
	 */
	async #enqueueWave(job) {
		const wave = await expandJobWave({
			repoRoot: this.repoRoot,
			options: { ...job.spec, probedSkip: job.probedSkip },
			catalog: this.catalog,
		})
		if (wave.error || wave.empty) {
			job.exitCode = wave.code ?? 0
			return 0
		}
		job.fingerprints = wave.fingerprints
		job.verdicts = wave.verdicts
		job.selection = wave.selection
		job.continueLoop = wave.continueLoop === true
		let runCount = 0
		for (const slot of wave.plan.slots) {
			if (slot.action === 'reuse') {
				const prev = this.state.suites[slot.key]
				const verdict = wave.verdicts.get(slot.key)
				const fp = this.#fingerprintFor(slot.suite, wave.fingerprints)
				const subtestTriggerHashes = verdict?.subtests
					? Object.fromEntries(Object.entries(verdict.subtests).map(([name, sub]) => [name, sub.triggerHash ?? null]))
					: null
				refreshEntryFingerprint(this.state, slot.key, fp.commitHash, fp.uncommittedHash, verdict?.triggerHash ?? null, subtestTriggerHashes)
				await writeState(this.repoRoot, this.state)
				this.sessionPassed.set(slot.key, prev?.status !== 'failed')
				await this.#reportResult(slot.suite, this.state.suites[slot.key], { reused: true })
				continue
			}
			if (slot.action === 'blocked') {
				await this.#recordBlocked(slot, wave.fingerprints)
				job.exitCode = 1
				continue
			}
			const item = this.queues.enqueueCli({
				key: slot.key,
				viewerId: job.viewerId,
				jobId: job.id,
				force: job.spec.force,
				subtests: slot.subtestsToRun,
				fileFilters: slot.fileFilters,
				reason: 'cli',
				slot,
			})
			job.pending.add(item.id)
			runCount++
			await this.#reportEnsure(slot.suite, wave.continueReasons?.get?.(slot.key))
			this.viewers.broadcast({
				type: 'queue-append',
				key: slot.key,
				reason: 'cli',
				jobId: job.id,
				remainingMs: this.#remainingMs(),
			})
		}
		await this.#flushReportEstimate()
		return runCount
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
			const snap = fingerprints?.nested?.get?.(suite.gitRoot) ?? fingerprints?.nested?.[suite.gitRoot]
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
	 * @returns {import('../core/estimate.mjs').EstimateTask[]} 队列+在跑的预估任务
	 */
	#estimateTasks() {
		const tasks = []
		for (const item of [...this.queues.cli, ...this.queues.fs]) {
			const suite = this.catalog.byKey.get(item.key)
			if (!suite) continue
			tasks.push(buildEstimateTask(suite, this.state.suites[item.key], {
				subtestsToRun: item.subtests,
				moduleCheckMs: this.moduleCheck.meanDurationMs(),
			}))
		}
		for (const [key] of this.running) {
			const suite = this.catalog.byKey.get(key)
			if (!suite) continue
			tasks.push(buildEstimateTask(suite, this.state.suites[key], {
				moduleCheckMs: this.moduleCheck.meanDurationMs(),
			}))
		}
		return tasks
	}

	/**
	 * @returns {number} 剩余预估
	 */
	#remainingMs() {
		const tasks = this.#estimateTasks()
		if (!tasks.length) return 0
		const estimate = summarizeEstimate(tasks, {
			memBudgetBytes: this.globalBudget.memBytes,
			cpuBudgetPct: CPU_BUDGET_PCT,
		})
		return estimate.etaMs
	}

	/**
	 * @returns {Promise<void>}
	 */
	async #flushReportEstimate() {
		if (!this.report) return
		const tasks = this.#estimateTasks()
		await this.report.setEstimatePlan(
			new Map(tasks.map(task => [task.key, task])),
			{ memBudgetBytes: this.globalBudget.memBytes, cpuBudgetPct: CPU_BUDGET_PCT },
		)
	}

	/**
	 * @param {import('./queues.mjs').QueueItem} item 项
	 * @returns {boolean} 硬就绪
	 */
	#isHardReady(item) {
		const suite = this.catalog.byKey.get(item.key)
		if (!suite) return false
		if (this.running.has(item.key)) return false
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			const inSession = this.running.has(depKey)
				|| this.queues.cli.some(q => q.key === depKey)
				|| this.queues.fs.some(q => q.key === depKey)
			if (inSession)
				if (this.sessionPassed.get(depKey) !== true) return false
				else continue
			const st = this.state.suites[depKey]
			if (st && (st.status === 'failed' || st.status === 'blocked'))
				return false
		}
		return true
	}

	/**
	 * @returns {Promise<void>}
	 */
	async #runLoop() {
		while (!this.closed) {
			this.queues.promotePrep()
			await this.#admitReady()
			if (this.#shouldExit()) {
				this.issueCache.pruneOlderThan()
				await this.close()
				return
			}
			if (this.queues.pendingEmpty() && !this.running.size)
				this.issueCache.pruneOlderThan()
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
			&& this.viewers.watchCount() === 0
			&& ![...this.jobs.values()].some(job => job.pending.size)
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
		this.running.set(key, { item, abort })
		this.#syncKeepAwake()
		const expectedMs = expectedRunDurationMs(suite, this.state.suites[key], item.subtests)
		this.viewers.broadcast({
			type: 'suite-start',
			key,
			jobId: item.jobId,
			expectedMs,
			remainingMs: this.#remainingMs(),
		})
		try {
			const skip = await this.#evalSkip(suite, item.subtests)
			if (skip) {
				await this.#finishSkip(item, suite, skip)
				return
			}
			const fp = this.#fingerprintFor(suite, this.jobs.get(item.jobId)?.fingerprints ?? {
				commitHash: await getHeadCommitHash(this.repoRoot),
				uncommittedHash: null,
			})
			const ticket = await this.moduleCheck.acquire()
			const result = await runSuite(
				suite,
				{
					subtests: item.subtests,
					onlyFiles: item.fileFilters?.length
						? resolveSerialOnlyFiles(suite, item.fileFilters, this.repoRoot).files
						: undefined,
					moduleCheckTicket: ticket,
					triggeredFiles: suiteTriggeredFiles(suite, []),
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
			if (this.moduleCheck.heldTicket === ticket)
				this.moduleCheck.ready(ticket)
			await upsertSuiteRun({
				repoRoot: this.repoRoot,
				state: this.state,
				suite,
				result,
				commitHash: fp.commitHash,
				uncommittedHash: fp.uncommittedHash,
				ranSubtests: item.subtests,
			})
			await writeState(this.repoRoot, this.state)
			this.sessionPassed.set(key, result.passed)
			await this.#reportResult(suite, this.state.suites[key])
			this.viewers.broadcast({
				type: 'suite-end',
				key,
				jobId: item.jobId,
				passed: result.passed,
				durationMs: result.durationMs,
				remainingMs: this.#remainingMs(),
			})
			if (!result.passed && item.jobId) {
				const job = this.jobs.get(item.jobId)
				if (job) job.exitCode = 1
			}
		}
		finally {
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
						remainingMs: this.#remainingMs(),
					})
			}
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
		const urls = skipBecauseUrlsForRun(suite, subtests)
		if (!urls?.length) return null
		/** @type {string[]} */
		const closed = []
		for (const url of urls) {
			const parsed = parseGithubIssueUrl(url)
			if (await this.issueCache.getClosed(
				url,
				() => parsed ? probeGithubIssueClosed(parsed) : Promise.resolve(false),
			))
				closed.push(url)
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
		this.viewers.broadcast({
			type: 'suite-end',
			key: item.key,
			jobId: item.jobId,
			passed,
			skipBecause: skip.urls,
			skipBecauseClosed: skip.closed,
			durationMs: 0,
			remainingMs: this.#remainingMs(),
		})
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
		if (job.continueLoop && job.exitCode === 0) {
			const more = await this.#enqueueWave(job)
			if (more > 0) return
		}
		job.done.resolve(job.exitCode)
		this.viewers.broadcast({ type: 'job-done', jobId: job.id, exitCode: job.exitCode })
		this.jobs.delete(job.id)
		if (this.queues.pendingEmpty() && !this.running.size)
			this.viewers.broadcast({ type: 'idle', remainingMs: 0 })
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
				remainingMs: this.#remainingMs(),
			})
		}
		for (const [, running] of this.running)
			if (running.item.viewerId === viewerId) {
				const stillWanted = this.queues.cli.some(q => q.key === running.item.key)
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
