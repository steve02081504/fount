import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import v8 from 'node:v8'

import { scheduleHeapSnapshotAnalysis } from './schedule_heap_snapshot_analysis.mjs'

/**
 * 轮询堆用量，近 OOM 时写入 V8 堆快照（Deno 无 setHeapSnapshotNearHeapLimit）。
 * @param {object} options 配置
 * @param {() => number} options.resolveLimitBytes 堆上限（字节）；0 表示禁用
 * @param {number} [options.snapshotCount] 最多写入份数
 * @param {string | null} [options.destDir] 目标目录；null 则留在进程 CWD
 * @param {string} [options.label] 日志前缀
 */
export function installNearOomHeapSnapshot({
	resolveLimitBytes,
	snapshotCount = Number(process.env.FOUNT_TEST_HEAP_SNAPSHOT_COUNT ?? 2),
	destDir = null,
	label = 'test',
}) {
	const limitBytes = resolveLimitBytes()
	if (!limitBytes || limitBytes <= 0 || !Number.isFinite(snapshotCount) || snapshotCount <= 0) return

	let snapshotsWritten = 0
	const timer = setInterval(() => {
		const { used_heap_size: usedBytes } = v8.getHeapStatistics()
		if (usedBytes / limitBytes < 0.95 || snapshotsWritten >= snapshotCount) return
		snapshotsWritten++
		const written = v8.writeHeapSnapshot()
		let dest = written
		if (destDir) {
			mkdirSync(destDir, { recursive: true })
			const ts = new Date().toISOString().replace(/[.:]/g, '-')
			dest = join(destDir, `${label}-${ts}-${snapshotsWritten}.heapsnapshot`)
			try { renameSync(written, dest) }
			catch { dest = written }
		}
		console.warn(`${label}: near-OOM heap snapshot ${snapshotsWritten}/${snapshotCount}: ${dest}`)
		scheduleHeapSnapshotAnalysis(dest)
	}, 2000)
	timer.unref?.()
}
