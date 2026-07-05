/**
 * Compare pidusage vs node-os-utils on a live subprocess tree.
 * deno run --allow-all -c ./deno.json ./src/scripts/test/tools/probe_pid_sampling.mjs
 */
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec@0.0.6'

import { collectProcessTreePids, samplePidsUsage } from '../core/proc_sample.mjs'

const INTERVAL_MS = 500

/** @type {import('npm:node-os-utils').default | null} */
let osu = null

/**
 *
 */
async function getOsu() {
	if (!osu) {
		const mod = await import('npm:node-os-utils')
		const { OSUtils } = mod.default ?? mod
		osu = new OSUtils()
	}
	return osu
}

/**
 * @param {number[]} pids
 */
async function sampleOsUtils(pids) {
	const osutils = await getOsu()
	let cpu = 0
	let memBytes = 0
	let ok = 0
	/** @type {string[]} */
	const errors = []
	for (const pid of pids) 
		try {
			const res = await osutils.process.byPid(pid)
			if (!res.success || !res.data) {
				errors.push(`${pid}:${res.error?.message ?? 'missing'}`)
				continue
			}
			ok++
			cpu += res.data.cpuUsage ?? 0
			const mem = res.data.memoryUsage
			memBytes += typeof mem?.bytes === 'number' ? mem.bytes : Number(mem) || 0
		}
		catch (error) {
			errors.push(`${pid}:${error?.message ?? error}`)
		}
	
	return {
		ok: ok > 0,
		cpu,
		memBytes,
		count: ok,
		errors: errors.length ? errors.join('; ') : undefined,
	}
}

/**
 * @param {() => boolean} alive
 * @param {() => number | undefined} getRootPid
 * @param {string} label
 */
async function sampleWhileRunning(alive, getRootPid, label) {
	/** @type {{ pidusage: object, osutils: object, treeSize: number }[]} */
	const ticks = []
	while (alive()) {
		const rootPid = getRootPid()
		if (rootPid) {
			const pids = await collectProcessTreePids(rootPid)
			const [puRaw, ou] = await Promise.all([
				samplePidsUsage(pids),
				sampleOsUtils(pids),
			])
			const pu = puRaw
				? { ok: true, cpu: puRaw.cpu, memBytes: puRaw.memBytes, count: pids.length }
				: { ok: false, error: 'pidusage failed' }
			ticks.push({ pidusage: pu, osutils: ou, treeSize: pids.length })
		}
		await new Promise(r => setTimeout(r, INTERVAL_MS))
	}

	/**
	 *
	 * @param arr
	 * @param pick
	 */
	const avg = (arr, pick) => {
		const vals = arr.map(pick).filter(v => v != null && Number.isFinite(v))
		return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
	}

	console.log(`\n=== ${label} ===`)
	console.log('samples:', ticks.length, '| tree sizes:', ticks.map(t => t.treeSize).join(', ') || '—')
	for (const t of ticks) {
		console.log('  pidusage:', JSON.stringify(t.pidusage))
		console.log('  osutils:', JSON.stringify(t.osutils))
	}
	const puCpu = avg(ticks, t => t.pidusage.ok ? t.pidusage.cpu : null)
	const ouCpu = avg(ticks, t => t.osutils.ok ? t.osutils.cpu : null)
	console.log('avg pidusage cpu%:', puCpu?.toFixed(1) ?? '—')
	console.log('avg osutils cpu%:', ouCpu?.toFixed(1) ?? '—')
	console.log('peak pidusage mem MB:', ticks.length
		? Math.max(...ticks.map(t => t.pidusage.ok ? t.pidusage.memBytes / (1024 * 1024) : 0)).toFixed(1)
		: '—')
	console.log('peak osutils mem MB:', ticks.length
		? Math.max(...ticks.map(t => t.osutils.ok ? t.osutils.memBytes / (1024 * 1024) : 0)).toFixed(1)
		: '—')
	return { ticks, puCpu, ouCpu }
}

const worker = `
const buf = new Uint8Array(64 * 1024 * 1024);
let x = 0;
const end = Date.now() + 8000;
while (Date.now() < end) {
  for (let i = 0; i < buf.length; i += 4096) buf[i] = (x++ & 255);
}
console.log('done');
`

/** @type {number | undefined} */
let rootPid
let running = true

const runPromise = execFile(process.execPath, ['eval', worker], {
	no_output_record: true,
	/**
	 *
	 * @param child
	 */
	on_spawn: child => { rootPid = child.pid ?? undefined },
	/**
	 *
	 * @param d
	 */
	on_stdout: d => process.stdout.write(d),
})

const samplePromise = sampleWhileRunning(() => running, () => rootPid, `single worker (pid ${rootPid ?? '?'})`)

await runPromise
running = false
const single = await samplePromise

running = true
rootPid = undefined

const spawnScript = `
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['eval', ${JSON.stringify(worker)}], { stdio: 'inherit' });
child.on('exit', c => process.exit(c ?? 0));
`

const nestedPromise = execFile(process.execPath, ['eval', spawnScript], {
	no_output_record: true,
	/**
	 *
	 * @param child
	 */
	on_spawn: child => { rootPid = child.pid ?? undefined },
})

const nestedSample = sampleWhileRunning(
	() => running,
	() => rootPid,
	`parent+child (root pid ${rootPid ?? '?'})`,
)

await nestedPromise
running = false
const nested = await nestedSample

console.log('\n=== summary ===')
console.log('- pidusage:', single.puCpu != null ? 'ok' : 'failed', '(process tree on Win OK)')
console.log('- node-os-utils process.byPid:', nested.ticks.some(t => t.osutils.ok) ? 'ok' : 'unavailable on Win32')
console.log('- tree enum: Win PowerShell Get-CimInstance; Unix node-os-utils process.list')
console.log('- fount test uses pidusage + shared tree code in proc_sample.mjs')
