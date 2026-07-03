/**
 * 双进程 Trystero 连通烟测（各进程独立 selfId）。
 * 用法：deno run -A -c deno.json src/scripts/test/live/trystero_smoke_dual.mjs
 */
import { spawn } from 'node:child_process'
import process from 'node:process'

import { startTestNostrRelay, stopTestNostrRelay } from './nostr_relay.mjs'

process.env.FOUNT_TEST = '1'
const { relayUrl } = await startTestNostrRelay()

/** @param {number} index 0|1 */
function spawnPeer(index) {
	return new Promise((resolve, reject) => {
		const child = spawn('deno', [
			'run', '--allow-all', '-c', 'deno.json',
			'src/scripts/test/live/trystero_smoke_worker.mjs',
			String(index),
		], {
			env: { ...process.env, FOUNT_TEST: '1', FOUNT_TEST_RELAY_URLS: relayUrl },
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let out = ''
		child.stdout.on('data', d => { out += d; process.stdout.write(d) })
		child.stderr.on('data', d => { process.stderr.write(d) })
		child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`peer ${index} exit ${code}\n${out}`)))
	})
}

try {
	const results = await Promise.all([spawnPeer(0), spawnPeer(1)])
	if (!results.some(r => r.includes('PEER_CONNECTED')))
		throw new Error('no PEER_CONNECTED in output')
	console.warn('dual-smoke: ok')
}
finally {
	await stopTestNostrRelay()
}
