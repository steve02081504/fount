/**
 * 跨进程端口租约自测。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { releasePortLease, tryAcquirePortLease } from '../core/port_lease.mjs'
import { TEST_PORT_BASE } from '../core/ports.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { childEnv } from '../env.mjs'

const LEASE_PORT = TEST_PORT_BASE + 7777

Deno.test('tryAcquirePortLease is exclusive within one process', async () => {
	const first = await tryAcquirePortLease(LEASE_PORT)
	assert(first)
	assertEquals(await tryAcquirePortLease(LEASE_PORT), first)
	await first.release()
	const second = await tryAcquirePortLease(LEASE_PORT)
	assert(second)
	assert(second !== first)
	await second.release()
})

Deno.test('tryAcquirePortLease blocks a sibling deno process', async () => {
	const held = await tryAcquirePortLease(LEASE_PORT + 1)
	assert(held)
	const dir = await Deno.makeTempDir({ prefix: 'fount-port-lease-' })
	const script = join(dir, 'probe.mjs')
	await writeFile(script, `\
import { tryAcquirePortLease } from ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'src/scripts/test/core/port_lease.mjs')).href)}
const lease = await tryAcquirePortLease(${LEASE_PORT + 1})
console.log(lease ? 'got' : 'blocked')
await lease?.release()
`, 'utf8')
	try {
		const child = spawn(Deno.execPath(), [
			'run', '--allow-scripts', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'), script,
		], {
			cwd: REPO_ROOT,
			env: childEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let out = ''
		child.stdout.on('data', chunk => { out += String(chunk) })
		child.stderr.on('data', chunk => { out += String(chunk) })
		const code = await new Promise(resolve => child.once('exit', resolve))
		assertEquals(code, 0, out)
		assertEquals(out.trim(), 'blocked')
	}
	finally {
		await held.release()
		await Deno.remove(dir, { recursive: true }).catch(() => {})
	}
})

Deno.test('tryAcquirePortLease reclaims stale lease from dead pid', async () => {
	const port = LEASE_PORT + 2
	await releasePortLease(port)
	const path = join(REPO_ROOT, 'data/test/tmp/port_leases', `${port}.lease`)
	await mkdir(join(REPO_ROOT, 'data/test/tmp/port_leases'), { recursive: true })
	// 极大 pid：本机几乎不可能存活，触发 clearStaleLease
	await writeFile(path, '2147483646\n0\n', 'utf8')
	const reclaimed = await tryAcquirePortLease(port)
	assert(reclaimed)
	await reclaimed.release()
})
