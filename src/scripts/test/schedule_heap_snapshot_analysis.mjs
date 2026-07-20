/* global Deno */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from './core/repo_root.mjs'

const ANALYZE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'tools/analyze_heap_snapshot.mjs')

/**
 * 在独立子进程分析堆快照（父进程近 OOM 时不可就地 JSON.parse）。
 * @param {string} snapshotPath 快照绝对路径
 */
export function scheduleHeapSnapshotAnalysis(snapshotPath) {
	const deno = typeof Deno !== 'undefined' ? Deno.execPath() : 'deno'
	const reportPath = `${snapshotPath}.analysis.txt`
	spawn(deno, [
		'run', '--allow-read', '--allow-write',
		'--v8-flags=--max-old-space-size=12288',
		'-c', join(REPO_ROOT, 'deno.json'),
		ANALYZE_SCRIPT, snapshotPath, '--out', reportPath,
	], { detached: true, stdio: 'ignore' }).unref()
}
