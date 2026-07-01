/**
 * fount 测试节点 worker：在子进程中启动 Web server 并保持存活。
 * 由 launch.mjs spawn；就绪时向 stdout 打印一行 JSON（含 baseUrl）。
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'
import { parseArgs } from 'node:util'
import v8 from 'node:v8'

import { hosturl } from '../../../server/server.mjs'
import { console } from '../../i18n.mjs'

import { bootInProcess } from './boot.mjs'

const heapSnapshotCount = Number(process.env.FOUNT_TEST_HEAP_SNAPSHOT_COUNT ?? 2)
if (Number.isFinite(heapSnapshotCount) && heapSnapshotCount > 0) {
	let snapshotsWritten = 0
	const timer = setInterval(() => {
		const stats = v8.getHeapStatistics()
		if (!stats.heap_size_limit) return
		const ratio = stats.used_heap_size / stats.heap_size_limit
		if (ratio < 0.95 || snapshotsWritten >= heapSnapshotCount) return
		snapshotsWritten++
		const path = v8.writeHeapSnapshot()
		console.warn(`test-node: near-OOM heap snapshot ${snapshotsWritten}/${heapSnapshotCount}: ${path}`)
	}, 2000)
	timer.unref?.()
}

const { values } = parseArgs({
	options: {
		'data-path': { type: 'string' },
		port: { type: 'string' },
		user: { type: 'string' },
		key: { type: 'string' },
		p2p: { type: 'boolean', default: false },
		'load-part': { type: 'string', multiple: true },
		bootstrap: { type: 'string' },
	},
})

const dataPath = values['data-path']
const username = values.user
const loadParts = values['load-part'] ?? []

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
		web: true,
		p2p: values.p2p,
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
