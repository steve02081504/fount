/* global Deno */
import os from 'node:os'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizePidusageCpuPct, treePidsFromProcessList } from '../core/proc_sample.mjs'

Deno.test('treePidsFromProcessList collects descendants', () => {
	const list = [
		{ pid: 1, parentPid: 0 },
		{ pid: 10, parentPid: 1 },
		{ pid: 11, parentPid: 1 },
		{ pid: 100, parentPid: 10 },
		{ pid: 99, parentPid: 50 },
	]
	assertEquals(treePidsFromProcessList(list, 1).sort((a, b) => a - b), [1, 10, 11, 100])
})

Deno.test('normalizePidusageCpuPct scales by core count', () => {
	const cores = Math.max(1, os.cpus().length)
	assertEquals(normalizePidusageCpuPct(cores * 100), 100)
	assertEquals(normalizePidusageCpuPct(cores * 50), 50)
})
