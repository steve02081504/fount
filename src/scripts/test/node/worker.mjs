/**
 * fount 测试节点 worker：在子进程中启动 Web server 并保持存活。
 * 由 launch.mjs spawn；就绪时向 stdout 打印一行 JSON（含 baseUrl）。
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { hosturl } from '../../../server/server.mjs'
import { console } from '../../i18n/bare.mjs'
import { parseArgsOrExit } from '../core/parse_args_or_exit.mjs'

import { bootInProcess } from './boot.mjs'

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
		'p2p-relay-url': { type: 'string' },
		'min-p2p-node': { type: 'boolean', default: false },
	},
})

const dataPath = values['data-path']
const username = values.user
const loadParts = values['load-part'] ?? []
const starts = values.starts && JSON.parse(values.starts)

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
		...values['p2p-relay-url'] ? { p2pRelayUrl: values['p2p-relay-url'] } : {},
		minP2pNode: values['min-p2p-node'],
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
