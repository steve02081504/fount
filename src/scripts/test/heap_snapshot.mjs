import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import v8 from 'node:v8'

import { scheduleHeapSnapshotAnalysis } from './schedule_heap_snapshot_analysis.mjs'

/** 近 OOM 时默认写入的堆快照份数。 */
export const DEFAULT_HEAP_SNAPSHOT_COUNT = 2

/**
 * @returns {number} 快照份数；0 表示禁用
 */
export function resolveHeapSnapshotCount() {
	const raw = process.env.FOUNT_TEST_HEAP_SNAPSHOT_COUNT
	if (raw === '' || raw === '0') return 0
	const parsed = Number(raw ?? DEFAULT_HEAP_SNAPSHOT_COUNT)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HEAP_SNAPSHOT_COUNT
}

/**
 * @param {string[]} flags V8 CLI flags（不含 `--v8-flags=` 前缀）
 * @returns {string | null} `--v8-flags=...` 或 null
 */
export function buildV8FlagsArg(flags) {
	const valid = flags.filter(Boolean)
	if (!valid.length) return null
	return `--v8-flags=${valid.join(',')}`
}

/**
 * 启用 V8 近 OOM 堆快照；若指定 destDir 则扫描 CWD 并搬迁。
 * @param {object} options 配置
 * @param {number} [options.snapshotCount] 最多写入份数
 * @param {string | null} [options.destDir] 目标目录；省略则留在 CWD
 * @param {string} [options.label] 日志前缀与文件名前缀
 * @param {string} [options.cwd] 扫描目录
 */
export function installNearOomHeapSnapshot({
	snapshotCount = resolveHeapSnapshotCount(),
	destDir = null,
	label = 'test',
	cwd = process.cwd(),
}) {
	if (!snapshotCount) return
	v8.setHeapSnapshotNearHeapLimit(snapshotCount)
	if (!destDir) return

	/** @type {Set<string>} */
	const seen = new Set()
	const needle = `.${process.pid}.`

	/**
	 * @param {string} name 文件名
	 * @returns {void}
	 */
	const tryRelocate = name => {
		if (seen.has(name)) return
		if (!name.startsWith('Heap.') || !name.endsWith('.heapsnapshot')) return
		if (!name.includes(needle)) return
		seen.add(name)
		mkdirSync(destDir, { recursive: true })
		const destName = label ? `${label}-${name}` : name
		const dest = join(destDir, destName)
		try {
			renameSync(join(cwd, name), dest)
			console.warn(`${label}: near-OOM heap snapshot: ${dest}`)
			scheduleHeapSnapshotAnalysis(dest)
		}
		catch { /* 并发搬迁或进程退出竞态 */ }
	}

	/**
	 *
	 */
	const scan = () => {
		try {
			for (const name of readdirSync(cwd))
				tryRelocate(name)
		}
		catch { /* cwd 不可用 */ }
	}

	scan()
	const timer = setInterval(scan, 3000)
	timer.unref?.()
	process.on('exit', scan)
}

/**
 * 搬迁 CWD 中本进程 pid 的 V8 堆快照（子进程退出后由父进程调用）。
 * @param {object} options 配置
 * @param {number} options.pid 子进程 pid
 * @param {string} options.destDir 目标目录
 * @param {string} options.cwd 源目录
 * @param {string} [options.label] 文件名前缀；空串保留原名
 * @returns {Promise<string[]>} 已搬运的快照绝对路径
 */
export async function collectHeapSnapshots({ pid, destDir, cwd, label = '' }) {
	if (!Number.isFinite(pid) || pid <= 0) return []
	const needle = `.${pid}.`
	/** @type {string[]} */
	const names = []
	try {
		for (const name of await readdir(cwd)) {
			if (!name.startsWith('Heap.') || !name.endsWith('.heapsnapshot')) continue
			if (!name.includes(needle)) continue
			names.push(name)
		}
	}
	catch { return [] }
	if (!names.length) return []

	await mkdir(destDir, { recursive: true })
	/** @type {string[]} */
	const saved = []
	for (const name of names) {
		const destName = label ? `${label}-${name}` : name
		const dest = join(destDir, destName)
		try {
			await rename(join(cwd, name), dest)
			saved.push(dest)
			scheduleHeapSnapshotAnalysis(dest)
		}
		catch { /* 已被其他路径收集 */ }
	}
	return saved
}
