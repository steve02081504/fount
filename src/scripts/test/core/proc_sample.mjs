/**
 * 子进程树 CPU/内存采样：pidusage 为主；进程树枚举尽力而为。
 */
import os from 'node:os'
import process from 'node:process'

import pidusage from 'npm:pidusage'

import { meanSample } from './baseline.mjs'

/** @type {Promise<import('npm:node-os-utils').default> | null} */
let osUtilsModule = null

/**
 * @returns {Promise<import('npm:node-os-utils').default>}
 */
async function getOsUtils() {
	if (!osUtilsModule) {
		const mod = await import('npm:node-os-utils')
		const { OSUtils } = mod.default ?? mod
		osUtilsModule = Promise.resolve(new OSUtils())
	}
	return osUtilsModule
}

/**
 * @param {object[]} list node-os-utils ProcessInfo[]
 * @param {number} rootPid 根 PID
 * @returns {number[]}
 */
export function treePidsFromProcessList(list, rootPid) {
	/** @type {Map<number, number[]>} */
	const byParent = new Map()
	for (const proc of list) {
		const ppid = proc.parentPid ?? proc.ppid
		if (ppid == null || proc.pid == null) continue
		if (!byParent.has(ppid)) byParent.set(ppid, [])
		byParent.get(ppid).push(proc.pid)
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
 * @param {number} rootPid 根 PID
 * @returns {Promise<number[]>}
 */
async function collectTreePidsWindows(rootPid) {
	try {
		const { powershell_exec } = await import('npm:@steve02081504/exec')
		const script = `
$root = ${rootPid}
$rows = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$byParent = @{}
foreach ($r in $rows) {
  if (-not $byParent.ContainsKey($r.ParentProcessId)) { $byParent[$r.ParentProcessId] = @() }
  $byParent[$r.ParentProcessId] += $r.ProcessId
}
$out = [System.Collections.Generic.HashSet[int]]::new()
$null = $out.Add($root)
$queue = [System.Collections.Generic.Queue[int]]::new()
$queue.Enqueue($root)
while ($queue.Count -gt 0) {
  $procId = $queue.Dequeue()
  if ($byParent.ContainsKey($procId)) {
    foreach ($c in $byParent[$procId]) {
      if ($out.Add($c)) { $queue.Enqueue($c) }
    }
  }
}
$out -join ','
`
		const res = await powershell_exec(script, { no_output_record: false })
		const text = (res.stdout ?? '').trim()
		if (!text) return [rootPid]
		const pids = text.split(',').map(s => Number(s.trim())).filter(n => n > 0)
		return pids.length ? pids : [rootPid]
	}
	catch {
		return [rootPid]
	}
}

/**
 * @param {number} rootPid suite 根 PID（exec on_spawn）
 * @returns {Promise<number[]>} 根 + 子孙 PID
 */
export async function collectProcessTreePids(rootPid) {
	if (!rootPid) return []

	try {
		const osutils = await getOsUtils()
		const listRes = await osutils.process.list()
		if (listRes.success && listRes.data?.length)
			return treePidsFromProcessList(listRes.data, rootPid)
	}
	catch { /* win32 等 */ }

	if (process.platform === 'win32')
		return collectTreePidsWindows(rootPid)

	return [rootPid]
}

/**
 * @param {number[]} pids 进程 ID 列表
 * @returns {Promise<{ cpu: number, memBytes: number } | null>} 聚合用量；失败 null
 */
export async function samplePidsUsage(pids) {
	if (!pids.length) return null
	try {
		const raw = await pidusage(pids.length === 1 ? pids[0] : pids)
		const entries = pids.length === 1 ? [raw] : Object.values(raw)
		let cpu = 0
		let memBytes = 0
		for (const s of entries) {
			cpu += s.cpu ?? 0
			memBytes += s.memory ?? 0
		}
		return { cpu, memBytes }
	}
	catch {
		return null
	}
}

/**
 * pidusage 多核 CPU% 压到调度语义 0–100。
 * @param {number} cpu pidusage 聚合 cpu
 * @returns {number}
 */
export function normalizePidusageCpuPct(cpu) {
	const cores = Math.max(1, os.cpus().length)
	return Math.min(100, cpu / cores)
}

/**
 * suite 子进程树用量跟踪（配合 exec on_spawn）。
 */
export class ProcessUsageTracker {
	/** @type {number | undefined} */
	#rootPid
	/** @type {number[]} */
	#memBytesSamples = []
	/** @type {number[]} */
	#cpuPctSamples = []

	/**
	 * @param {import('node:child_process').ChildProcess} child spawn 子进程
	 */
	setRootFromChild(child) {
		if (child.pid != null) this.#rootPid = child.pid
	}

	/** 采样一次（忽略已退出 PID）。 */
	async sample() {
		if (!this.#rootPid) return
		const pids = await collectProcessTreePids(this.#rootPid)
		const usage = await samplePidsUsage(pids)
		if (!usage) return
		this.#memBytesSamples.push(usage.memBytes)
		this.#cpuPctSamples.push(normalizePidusageCpuPct(usage.cpu))
	}

	/**
	 * @returns {{ peakMemMb?: number, avgCpuPct?: number }}
	 */
	finish() {
		const peakMemMb = this.#memBytesSamples.length
			? Math.max(0, Math.ceil(Math.max(...this.#memBytesSamples) / (1024 * 1024)))
			: undefined
		const avgCpuPct = meanSample(this.#cpuPctSamples) ?? undefined
		return { peakMemMb, avgCpuPct }
	}
}
