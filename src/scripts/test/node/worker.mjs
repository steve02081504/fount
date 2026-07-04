/**
 * fount 测试节点 worker：在子进程中启动 Web server 并保持存活。
 * 由 launch.mjs spawn；就绪时向 stdout 打印一行 JSON（含 baseUrl）。
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'
import v8 from 'node:v8'

import { hosturl } from '../../../server/server.mjs'
import { console } from '../../i18n.mjs'
import { parseArgsOrExit } from '../core/parse_args_or_exit.mjs'

import { bootInProcess } from './boot.mjs'

/** 与 launch.mjs 中 --max-old-space-size 默认值一致。 */
const DEFAULT_TEST_NODE_HEAP_MB = 1024

/**
 * 近 OOM 判定用的堆上限（字节）。
 * Deno 的 heap_size_limit 会高于 --max-old-space-size 的实际 OOM 线，须用配置值。
 * @returns {number} 0 表示未设上限、不启用近 OOM 快照
 */
function resolveNearOomHeapLimitBytes() {
	const raw = process.env.FOUNT_TEST_NODE_HEAP_MB
	if (raw === '' || raw === '0') return 0
	const parsed = Number(raw)
	const heapMb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TEST_NODE_HEAP_MB
	return heapMb * 1024 * 1024
}

const nearOomHeapLimitBytes = resolveNearOomHeapLimitBytes()
const heapSnapshotCount = Number(process.env.FOUNT_TEST_HEAP_SNAPSHOT_COUNT ?? 2)
if (nearOomHeapLimitBytes > 0 && Number.isFinite(heapSnapshotCount) && heapSnapshotCount > 0) {
	let snapshotsWritten = 0
	const timer = setInterval(() => {
		const { used_heap_size: usedBytes } = v8.getHeapStatistics()
		const ratio = usedBytes / nearOomHeapLimitBytes
		if (ratio < 0.95 || snapshotsWritten >= heapSnapshotCount) return
		snapshotsWritten++
		const path = v8.writeHeapSnapshot()
		console.warn(`test-node: near-OOM heap snapshot ${snapshotsWritten}/${heapSnapshotCount}: ${path}`)
	}, 2000)
	timer.unref?.()
}

const { values } = parseArgsOrExit({
	options: {
		'data-path': { type: 'string' },
		port: { type: 'string' },
		user: { type: 'string' },
		key: { type: 'string' },
		starts: { type: 'string' },
		'needs-output': { type: 'boolean', default: false },
		'load-part': { type: 'string', multiple: true },
		bootstrap: { type: 'string' },
	},
})

const dataPath = values['data-path']
const username = values.user
const loadParts = values['load-part'] ?? []
const starts = JSON.parse(values.starts)

if (!dataPath) {
	console.errorI18n('fountConsole.test.nodeWorker.dataPathRequired')
	process.exit(2)
}
if (!values.port) {
	console.errorI18n('fountConsole.test.nodeWorker.portRequired')
	process.exit(2)
}
if (!values.key) {
	console.errorI18n('fountConsole.test.nodeWorker.keyRequired')
	process.exit(2)
}
if (!username) {
	console.errorI18n('fountConsole.test.nodeWorker.userRequired')
	process.exit(2)
}

try {
	await bootInProcess({
		dataPath,
		port: Number(values.port),
		username,
		apiKey: values.key,
		starts,
		needsOutput: values['needs-output'],
		loadParts,
		bootstrap: values.bootstrap,
	})
}
catch (error) {
	console.errorI18n('fountConsole.test.nodeWorker.error', { error })
	process.exit(1)
}

console.log(JSON.stringify({
	ready: true,
	baseUrl: hosturl,
	port: Number(values.port),
	username,
	apiKey: values.key,
}))
