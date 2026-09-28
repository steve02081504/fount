/**
 * 子进程树 CPU/内存采样：进程表快照 + 相邻快照 CPU 时间差累计。
 *
 * 不再依赖 pidusage（新 PID 首读会立即重查并把 uptime 取整到秒，短命子进程永远只拿到该首读，
 * 导致 CPU ≈ 0）与 node-os-utils `process.list()`（各平台上限 100 进程）。
 */
import os from 'node:os'
import process from 'node:process'

/** 采样间隔（毫秒）。 */
const SNAPSHOT_INTERVAL_MS = 2000

const BYTES_PER_MB = 1024 * 1024

/**
 * Windows 进程表：一次性 PowerShell `Get-CimInstance Win32_Process`，输出制表符分隔行，JS 侧建树。
 * CPU 时间单位为 100ns。
 * @returns {Promise<Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>>} 进程表；失败空数组
 */
async function snapshotProcessTableWindows() {
	const { powershell_exec } = await import('npm:@steve02081504/exec')
	const script = `
Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, KernelModeTime, UserModeTime, WorkingSetSize | ForEach-Object {
	"$($_.ProcessId)\`t$($_.ParentProcessId)\`t$([int64]$_.KernelModeTime)\`t$([int64]$_.UserModeTime)\`t$([int64]$_.WorkingSetSize)"
}
`
	const res = await powershell_exec(script)
	return parseWindowsTable(res.stdout ?? '')
}

/**
 * @param {string} stdout 制表符分隔的进程表
 * @returns {Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>} 进程表
 */
function parseWindowsTable(stdout) {
	/** @type {Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>} */
	const table = []
	for (const line of stdout.split(/\r?\n/)) {
		const text = line.trim()
		if (!text) continue
		const [pidText, ppidText, kernelText, userText, rssText] = text.split('\t')
		const pid = Number(pidText)
		if (!Number.isFinite(pid) || pid <= 0) continue
		table.push({
			pid,
			ppid: Number(ppidText) || 0,
			cpuMs: (Number(kernelText) + Number(userText)) / 10000,
			rssBytes: Number(rssText) || 0,
		})
	}
	return table
}

/**
 * POSIX 进程表：`ps -A`，rss 为 KB，time 为累计 CPU。
 * @returns {Promise<Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>>} 进程表；失败空数组
 */
async function snapshotProcessTablePosix() {
	const { execFile } = await import('npm:@steve02081504/exec')
	const res = await execFile('ps', ['-A', '-o', 'pid=,ppid=,rss=,time='])
	return parsePosixTable(res.stdout ?? '')
}

/**
 * @param {string} stdout `ps` 输出
 * @returns {Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>} 进程表
 */
function parsePosixTable(stdout) {
	/** @type {Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>} */
	const table = []
	for (const line of stdout.split(/\r?\n/)) {
		const parts = line.trim().split(/\s+/)
		if (parts.length < 4) continue
		const pid = Number(parts[0])
		if (!Number.isFinite(pid) || pid <= 0) continue
		const ppid = Number(parts[1])
		const rssKb = Number(parts[2])
		table.push({
			pid,
			ppid: Number.isFinite(ppid) ? ppid : 0,
			cpuMs: parseCpuTimeToMs(parts[3]),
			rssBytes: (Number.isFinite(rssKb) ? rssKb : 0) * 1024,
		})
	}
	return table
}

/**
 * 解析 `ps` 累计 CPU 时间 `[[dd-]hh:]mm:ss[.ff]` 为毫秒。
 * @param {string} time `ps time` 字段
 * @returns {number} 毫秒；无法解析为 0
 */
export function parseCpuTimeToMs(time) {
	if (!time) return 0
	let rest = String(time).trim()
	let days = 0
	const dashIndex = rest.indexOf('-')
	if (dashIndex !== -1) {
		days = Number(rest.slice(0, dashIndex)) || 0
		rest = rest.slice(dashIndex + 1)
	}
	const parts = rest.split(':')
	let seconds
	if (parts.length === 1) seconds = Number(parts[0]) || 0
	else if (parts.length === 2) seconds = (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0)
	else seconds = (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0)
	return (days * 86400 + seconds) * 1000
}

/**
 * 枚举全机进程表。
 * @returns {Promise<Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>>} 进程表；任何失败返回空数组
 */
export async function snapshotProcessTable() {
	try {
		if (process.platform === 'win32') return await snapshotProcessTableWindows()
		return await snapshotProcessTablePosix()
	}
	catch {
		return []
	}
}

/**
 * 从进程表自 rootPid 向下收集根及其全部子孙 PID；rootPid 始终包含在结果中。
 * @param {Array<{ pid: number, ppid: number }>} table 进程表
 * @param {number} rootPid 根 PID
 * @returns {number[]} 根及其全部子孙 PID
 */
export function treePidsFromTable(table, rootPid) {
	/** @type {Map<number, number[]>} */
	const byParent = new Map()
	for (const proc of table) {
		if (proc.ppid == null || proc.pid == null) continue
		if (!byParent.has(proc.ppid)) byParent.set(proc.ppid, [])
		byParent.get(proc.ppid).push(proc.pid)
	}
	/** @type {Set<number>} */
	const out = new Set([rootPid])
	/** @type {number[]} */
	const queue = [rootPid]
	while (queue.length) {
		const pid = queue.shift()
		for (const child of byParent.get(pid) ?? []) {
			if (out.has(child)) continue
			out.add(child)
			queue.push(child)
		}
	}
	return [...out]
}

/**
 * suite 子进程树用量跟踪：每个快照按相邻 CPU 时间差累计消耗。
 */
export class ProcessUsageTracker {
	/** @type {number | undefined} */
	#rootPid
	/** @type {Map<number, number>} */
	#prevCpuMs = new Map()
	#consumedMs = 0
	/** @type {number | undefined} */
	#firstSnapshotAt
	/** @type {number | undefined} */
	#lastSnapshotAt
	#peakMemBytes = 0
	#peakUnitMemBytes = 0
	#snapshotCount = 0
	#lastTreeRssBytes = 0
	#trackUnits

	/**
	 * @param {boolean} [trackUnits] 是否跟踪单文件单元峰值（serial suite 用）
	 */
	constructor(trackUnits = false) {
		this.#trackUnits = trackUnits
	}

	/**
	 * @param {import('node:child_process').ChildProcess} child spawn 子进程
	 */
	setRootFromChild(child) {
		if (child.pid != null) this.#rootPid = child.pid
	}

	/**
	 * @param {number} pid 根 PID
	 */
	setRootPid(pid) {
		if (pid != null) this.#rootPid = pid
	}

	/** @returns {number | undefined} 根 PID */
	get rootPid() {
		return this.#rootPid
	}

	/** @returns {number} 最近一次快照的子树 RSS 字节数 */
	get lastTreeRssBytes() {
		return this.#lastTreeRssBytes
	}

	/**
	 * 处理一次进程表快照（同步）。新 PID 本轮不计 CPU；用当前树值替换上一轮映射。
	 * @param {Array<{ pid: number, ppid: number, cpuMs: number, rssBytes: number }>} table 进程表
	 * @returns {void}
	 */
	onSnapshot(table) {
		if (!this.#rootPid) return
		/** @type {Map<number, number>} */
		const rssByPid = new Map()
		/** @type {Map<number, number>} */
		const cpuByPid = new Map()
		for (const proc of table) {
			rssByPid.set(proc.pid, proc.rssBytes ?? 0)
			cpuByPid.set(proc.pid, proc.cpuMs ?? 0)
		}

		const pids = treePidsFromTable(table, this.#rootPid)
		/** @type {Map<number, number>} */
		const currentCpuMs = new Map()
		let memBytes = 0
		for (const pid of pids) {
			if (!cpuByPid.has(pid)) continue
			const cpuMs = cpuByPid.get(pid)
			currentCpuMs.set(pid, cpuMs)
			const previous = this.#prevCpuMs.get(pid)
			if (previous != null && cpuMs >= previous) this.#consumedMs += cpuMs - previous
			memBytes += rssByPid.get(pid) ?? 0
		}
		this.#prevCpuMs = currentCpuMs
		this.#lastTreeRssBytes = memBytes
		if (memBytes > this.#peakMemBytes) this.#peakMemBytes = memBytes

		if (this.#trackUnits) {
			let unitBytes = 0
			for (const proc of table) {
				if (proc.ppid !== this.#rootPid) continue
				let subtreeBytes = 0
				for (const pid of treePidsFromTable(table, proc.pid))
					subtreeBytes += rssByPid.get(pid) ?? 0
				if (subtreeBytes > unitBytes) unitBytes = subtreeBytes
			}
			if (unitBytes > this.#peakUnitMemBytes) this.#peakUnitMemBytes = unitBytes
		}

		const now = Date.now()
		this.#firstSnapshotAt ??= now
		this.#lastSnapshotAt = now
		this.#snapshotCount++
	}

	/**
	 * @returns {{ peakMemMb?: number, peakUnitMemMb?: number, avgCpuPct?: number }} 采样汇总
	 */
	finish() {
		const peakMemMb = this.#snapshotCount
			? Math.max(0, Math.ceil(this.#peakMemBytes / BYTES_PER_MB))
			: undefined
		const peakUnitMemMb = this.#trackUnits && this.#snapshotCount
			? Math.max(0, Math.ceil(this.#peakUnitMemBytes / BYTES_PER_MB))
			: undefined
		/** @type {number | undefined} */
		let avgCpuPct
		if (this.#snapshotCount >= 2 && this.#lastSnapshotAt > this.#firstSnapshotAt) {
			const elapsedMs = this.#lastSnapshotAt - this.#firstSnapshotAt
			const cores = Math.max(1, os.cpus().length)
			avgCpuPct = Math.min(100, Math.max(0, this.#consumedMs / elapsedMs / cores * 100))
		}
		return { peakMemMb, peakUnitMemMb, avgCpuPct }
	}
}

/**
 * 共享采样器：首个订阅者启动 2s 定时器并立即采一次，最后一个退订停止。
 */
export class SharedProcessSampler {
	/** @type {SharedProcessSampler | undefined} */
	static #instance
	/** @type {Set<ProcessUsageTracker>} */
	#trackers = new Set()
	/** @type {ReturnType<typeof setInterval> | null} */
	#interval = null
	#sampling = false

	/** @returns {SharedProcessSampler} 单例 */
	static get instance() {
		if (!SharedProcessSampler.#instance) SharedProcessSampler.#instance = new SharedProcessSampler()
		return SharedProcessSampler.#instance
	}

	/**
	 * @param {ProcessUsageTracker} tracker 跟踪器
	 * @returns {void}
	 */
	subscribe(tracker) {
		this.#trackers.add(tracker)
		if (this.#interval) return
		this.#interval = setInterval(() => { this.sampleNow() }, SNAPSHOT_INTERVAL_MS)
		this.#interval.unref?.()
		this.sampleNow()
	}

	/**
	 * @param {ProcessUsageTracker} tracker 跟踪器
	 * @returns {void}
	 */
	unsubscribe(tracker) {
		this.#trackers.delete(tracker)
		if (!this.#trackers.size && this.#interval) {
			clearInterval(this.#interval)
			this.#interval = null
		}
	}

	/**
	 * 采样一次并分发给订阅者；不重入，失败吞掉。
	 * @returns {Promise<void>}
	 */
	async sampleNow() {
		if (this.#sampling) return
		this.#sampling = true
		try {
			const table = await snapshotProcessTable()
			for (const tracker of this.#trackers) tracker.onSnapshot(table)
		}
		catch { /* 采样失败忽略 */ }
		finally {
			this.#sampling = false
		}
	}

	/** @returns {number} 各订阅者最近一次子树 RSS 之和（字节）；无订阅者为 0 */
	getTotalMemBytes() {
		let total = 0
		for (const tracker of this.#trackers) total += tracker.lastTreeRssBytes ?? 0
		return total
	}
}
