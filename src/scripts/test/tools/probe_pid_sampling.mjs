/**
 * 进程树采样探针：真实子进程 + 孙进程，打印树规模与资源汇总。
 * deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/probe_pid_sampling.mjs
 */
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

import { SharedProcessSampler, snapshotProcessTable, treePidsFromTable, ProcessUsageTracker } from '../core/proc_sample.mjs'

const worker = `
const buf = new Uint8Array(64 * 1024 * 1024);
let x = 0;
const end = Date.now() + 8000;
while (Date.now() < end) {
	for (let i = 0; i < buf.length; i += 4096) buf[i] = (x++ & 255);
}
console.log('done');
`

const spawnScript = `
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['eval', ${JSON.stringify(worker)}], { stdio: 'inherit' });
child.on('exit', c => process.exit(c ?? 0));
`

const tracker = new ProcessUsageTracker(true)
const sampler = SharedProcessSampler.instance
sampler.subscribe(tracker)

let running = true
let maxTreeSize = 0

const pollPromise = (async () => {
	while (running) {
		if (tracker.rootPid) {
			const table = await snapshotProcessTable()
			const size = treePidsFromTable(table, tracker.rootPid).length
			if (size > maxTreeSize) maxTreeSize = size
		}
		await new Promise(resolve => { setTimeout(resolve, 300) })
	}
})()

await execFile(process.execPath, ['eval', spawnScript], {
	no_output_record: true,
	/**
	 * 记录根进程 PID 供采样。
	 * @param {import('node:child_process').ChildProcess} child spawn 子进程
	 * @returns {void}
	 */
	on_spawn: child => tracker.setRootFromChild(child),
	/**
	 * 转发 worker stdout。
	 * @param {string | Uint8Array} data stdout 片段
	 * @returns {void}
	 */
	on_stdout: data => process.stdout.write(data),
})

running = false
await pollPromise
const totalMemBytes = sampler.getTotalMemBytes()
sampler.unsubscribe(tracker)

const { peakMemMb, peakUnitMemMb, avgCpuPct } = tracker.finish()
console.log('\n=== process tree sampling ===')
console.log('root pid:', tracker.rootPid ?? '?')
console.log('tree size (max concurrent pids):', maxTreeSize)
console.log('peak tree memory MB:', peakMemMb ?? '—')
console.log('peak unit subtree memory MB:', peakUnitMemMb ?? '—')
console.log('avg cpu%:', avgCpuPct?.toFixed(1) ?? '—')
console.log('sampler total mem bytes:', totalMemBytes)
