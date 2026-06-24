/**
 * fount 测试节点 worker：在子进程中启动 Web server 并保持存活。
 * 由 launch.mjs spawn；就绪时向 stdout 打印一行 JSON（含 baseUrl）。
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'
import { parseArgs } from 'node:util'

import { hosturl } from '../../../server/server.mjs'

import { bootInProcess } from './boot.mjs'

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
	console.error('node worker: --data-path required')
	process.exit(2)
}
if (!values.port) {
	console.error('node worker: --port required (launch via launch.mjs)')
	process.exit(2)
}
if (!values.key) {
	console.error('node worker: --key required (launch via launch.mjs)')
	process.exit(2)
}
if (!username) {
	console.error('node worker: --user required')
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
	console.error('node worker:', error)
	process.exit(1)
}

console.log(JSON.stringify({
	ready: true,
	baseUrl: hosturl,
	port: Number(values.port),
	username,
	apiKey: values.key,
}))
