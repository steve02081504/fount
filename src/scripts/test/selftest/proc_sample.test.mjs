/* global Deno */
import process from 'node:process'

import { assert, assertEquals, assertGreater } from 'jsr:@std/assert'
import { execFile } from 'npm:@steve02081504/exec'


import { parseCpuTimeToMs, SharedProcessSampler, snapshotProcessTable, treePidsFromTable, ProcessUsageTracker } from '../core/proc_sample.mjs'
import { waitUntil } from '../core/wait.mjs'

Deno.test('treePidsFromTable collects descendants and keeps the root', () => {
	const table = [
		{ pid: 1, ppid: 0 },
		{ pid: 10, ppid: 1 },
		{ pid: 11, ppid: 1 },
		{ pid: 100, ppid: 10 },
		{ pid: 99, ppid: 50 },
	]
	assertEquals(treePidsFromTable(table, 1).sort((a, b) => a - b), [1, 10, 11, 100])
	assertEquals(treePidsFromTable(table, 999), [999])
	assertEquals(treePidsFromTable([], 7), [7])
})

Deno.test('parseCpuTimeToMs parses ps cpu time formats', () => {
	assertEquals(parseCpuTimeToMs('00:01'), 1000)
	assertEquals(parseCpuTimeToMs('01:02:03'), 3_723_000)
	assertEquals(parseCpuTimeToMs('1-02:03:04'), 93_784_000)
	assertEquals(parseCpuTimeToMs('12:34.5'), 754_500)
})

const chainScript = `
import { spawn } from 'node:child_process';
const midScript = "import { spawn } from 'node:child_process'; const leaf = spawn(process.execPath, ['eval', 'setTimeout(() => {}, 4000)'], { stdio: 'ignore' }); console.log('GRANDCHILD ' + leaf.pid); setTimeout(() => {}, 4000);";
const mid = spawn(process.execPath, ['eval', midScript], { stdio: 'inherit' });
console.log('ROOT ' + process.pid + ' CHILD ' + mid.pid);
mid.on('exit', c => process.exit(c ?? 0));
setTimeout(() => {}, 4000);
`

Deno.test('snapshotProcessTable sees a live parent->child->grandchild chain', async () => {
	let stdout = ''
	const run = execFile(process.execPath, ['eval', chainScript], {
		no_output_record: true,
		/**
		 * @param {string | Uint8Array} data stdout 片段
		 * @returns {void}
		 */
		on_stdout: data => { stdout += String(data) },
	})
	await waitUntil(() => /CHILD \d+/.test(stdout) && /GRANDCHILD \d+/.test(stdout), 10_000)
	const rootPid = Number(stdout.match(/ROOT (\d+) CHILD/)[1])
	const childPid = Number(stdout.match(/CHILD (\d+)/)[1])
	const grandPid = Number(stdout.match(/GRANDCHILD (\d+)/)[1])

	const table = await snapshotProcessTable()
	const pids = treePidsFromTable(table, rootPid)
	assert(pids.includes(rootPid), `tree missing root ${rootPid}`)
	assert(pids.includes(childPid), `tree missing child ${childPid}`)
	assert(pids.includes(grandPid), `tree missing grandchild ${grandPid}`)

	await run
})

const busyScript = `
const end = Date.now() + 3000;
let x = 0;
while (Date.now() < end) x = (x + 1) % 1000000;
console.log('done ' + x);
`

Deno.test('busy child accumulates cpu across manual sampleNow calls', async () => {
	const sampler = SharedProcessSampler.instance
	const tracker = new ProcessUsageTracker()
	const run = execFile(process.execPath, ['eval', busyScript], {
		no_output_record: true,
		/**
		 * @param {import('node:child_process').ChildProcess} child spawn 子进程
		 * @returns {void}
		 */
		on_spawn: child => tracker.setRootFromChild(child),
	})
	sampler.subscribe(tracker)
	await waitUntil(() => tracker.rootPid, 5000)
	for (let i = 0; i < 12; i++) {
		await sampler.sampleNow()
		await new Promise(resolve => { setTimeout(resolve, 250) })
	}
	await run
	sampler.unsubscribe(tracker)
	const { avgCpuPct } = tracker.finish()
	assertGreater(avgCpuPct ?? 0, 0)
})

const MB = 1024 * 1024

Deno.test('cpu delta accounting accumulates per pid across snapshots', async () => {
	const tracker = new ProcessUsageTracker()
	tracker.setRootPid(100)
	tracker.onSnapshot([
		{ pid: 100, ppid: 1, cpuMs: 1000, rssBytes: 4 * MB },
		{ pid: 200, ppid: 100, cpuMs: 500, rssBytes: 8 * MB },
	])
	await new Promise(resolve => { setTimeout(resolve, 20) })
	tracker.onSnapshot([
		{ pid: 100, ppid: 1, cpuMs: 1100, rssBytes: 4 * MB },
		{ pid: 200, ppid: 100, cpuMs: 700, rssBytes: 8 * MB },
	])
	const { avgCpuPct, peakMemMb } = tracker.finish()
	assertGreater(avgCpuPct ?? 0, 0)
	assertEquals(peakMemMb, 12)
})

Deno.test('cpu delta accounting ignores pids new to a snapshot', async () => {
	const tracker = new ProcessUsageTracker()
	tracker.setRootPid(100)
	tracker.onSnapshot([
		{ pid: 100, ppid: 1, cpuMs: 1000, rssBytes: 4 * MB },
	])
	await new Promise(resolve => { setTimeout(resolve, 20) })
	tracker.onSnapshot([
		{ pid: 100, ppid: 1, cpuMs: 1000, rssBytes: 4 * MB },
		{ pid: 200, ppid: 100, cpuMs: 700, rssBytes: 8 * MB },
	])
	const { avgCpuPct } = tracker.finish()
	assertEquals(avgCpuPct ?? 0, 0)
})
