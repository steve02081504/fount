/**
 * 内核单例、退出、skip_because 不 spawn、模组检查 HTTP。
 */
/* global Deno */
import process from 'node:process'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { acquireModuleCheckTicket, signalModuleCheckReady } from '../hub/clients/module_check.mjs'
import { ignoreWatchPath } from '../kernel/runtime.mjs'
import { startTestKernel } from '../kernel/server.mjs'

/** 避开生产 8903 与 hub 自测 18903。 */
const KERNEL_PORT = 18904
const SKIP_URL = 'https://github.com/denoland/deno/issues/35804'

/**
 * @returns {Promise<boolean>} 视为未关
 */
async function issueStillOpen() {
	return false
}

/**
 * @returns {Promise<boolean>} 视为已关
 */
async function issueClosed() {
	return true
}

/**
 * @param {string} name dummy suite 名
 * @param {string | string[]} urls issue URL
 * @returns {object} suite
 */
function dummySkipSuite(name, urls) {
	return {
		manifestId: 'testkit',
		name,
		skipBecause: Array.isArray(urls) ? urls : [urls],
		run: ['true'],
		triggers: [],
		dependencies: [],
		heavy: false,
	}
}

Deno.test('ignoreWatchPath drops git, node_modules, debug_logs, data/test', () => {
	assertEquals(ignoreWatchPath('.git/HEAD'), true)
	assertEquals(ignoreWatchPath('foo/node_modules/x'), true)
	assertEquals(ignoreWatchPath('debug_logs/a'), true)
	assertEquals(ignoreWatchPath('data/test/report.md'), true)
	assertEquals(ignoreWatchPath('src/scripts/test/cli.mjs'), false)
	assertEquals(ignoreWatchPath('data/users/u/chars/c/test/manifest.json'), false)
})

Deno.test('kernel auto-exits when queues empty and no watch WS', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT,
		autoExit: true,
		watchFs: false,
		writeReport: false,
	})
	const ws = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', reject, { once: true })
	})
	ws.send(JSON.stringify({ type: 'hello', watch: false }))
	await new Promise(resolve => setTimeout(resolve, 50))
	ws.close()
	await handle.closed
})

Deno.test('second kernel listen EADDRINUSE; first stays healthy', async () => {
	const first = await startTestKernel({
		port: KERNEL_PORT + 1,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const health = await fetch(`${first.url}/health`)
		assertEquals(health.status, 200)
		await assertRejects(
			() => startTestKernel({
				port: KERNEL_PORT + 1,
				autoExit: false,
				watchFs: false,
				writeReport: false,
			}),
		)
		const again = await fetch(`${first.url}/health`)
		assertEquals(again.status, 200)
	}
	finally {
		await first.close()
	}
})

Deno.test('watch WS keeps kernel alive until disconnect', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 2,
		autoExit: true,
		watchFs: false,
		writeReport: false,
	})
	const ws = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', reject, { once: true })
	})
	const accepted = new Promise(resolve => {
		ws.addEventListener('message', event => {
			const msg = JSON.parse(String(event.data))
			if (msg.type === 'accepted') resolve()
		}, { once: true })
	})
	ws.send(JSON.stringify({ type: 'hello', watch: true }))
	await accepted
	assertEquals(handle.kernel.viewers.watchCount(), 1)
	assertEquals(handle.kernel.closed, false)
	ws.close()
	await handle.closed
})

/**
 * @param {import('../kernel/runtime.mjs').TestKernel} kernel 内核
 * @param {object} suite dummy suite
 * @param {string} jobId job
 * @returns {Promise<{ end: object | null, job: object }>} 结束事件与 job
 */
async function enqueueAndAwaitSkip(kernel, suite, jobId) {
	const key = `${suite.manifestId}:${suite.name}`
	kernel.catalog.allSuites.push(suite)
	kernel.catalog.byKey.set(key, suite)
	/** @type {object | null} */
	let end = null
	kernel.viewers.add({
		readyState: 1,
		/**
		 * @param {string} raw 事件 JSON
		 * @returns {void}
		 */
		send: raw => {
			const msg = JSON.parse(raw)
			if (msg.type === 'suite-end') end = msg
		},
	}, { mode: 'overview' })
	const item = kernel.queues.enqueueCli({ key, viewerId: 'v', jobId })
	const job = {
		id: jobId,
		viewerId: 'v',
		spec: {},
		pending: new Set([item.id]),
		probedSkip: new Set(),
		continueLoop: false,
		exitCode: 0,
		done: Promise.withResolvers(),
		fingerprints: { commitHash: null, uncommittedHash: null },
	}
	kernel.jobs.set(job.id, job)
	kernel.wake()
	await job.done.promise
	return { end, job }
}

Deno.test('skip_because open does not spawn and counts as pass', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 3,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		handle.kernel.issueCache.getClosed = issueStillOpen
		const { end } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_probe_open__', SKIP_URL),
			'skip-open',
		)
		assertEquals(end?.passed, true)
		assertEquals(end?.skipBecause, [SKIP_URL])
		assertEquals(handle.kernel.running.size, 0)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because closed fails without spawn', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 4,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		handle.kernel.issueCache.getClosed = issueClosed
		const { end, job } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_probe_closed__', SKIP_URL),
			'skip-closed',
		)
		assertEquals(end?.passed, false)
		assertEquals(end?.skipBecause, [SKIP_URL])
		assertEquals(end?.skipBecauseClosed, [SKIP_URL])
		assertEquals(job.exitCode, 1)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because any closed URL fails and lists follow-up', async () => {
	const urlB = 'https://github.com/denoland/deno/issues/36168'
	const handle = await startTestKernel({
		port: KERNEL_PORT + 6,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		/**
		 * @param {string} url issue URL
		 * @returns {Promise<boolean>} 仅第二号已关
		 */
		async function onlySecondClosed(url) {
			return url === urlB
		}
		handle.kernel.issueCache.getClosed = onlySecondClosed
		const { end, job } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_probe_mixed__', [SKIP_URL, urlB]),
			'skip-mixed',
		)
		assertEquals(end?.passed, false)
		assertEquals(end?.skipBecause, [SKIP_URL, urlB])
		assertEquals(end?.skipBecauseClosed, [urlB])
		assertEquals(job.exitCode, 1)
	}
	finally {
		await handle.close()
	}
})

Deno.test('module-check HTTP: second acquire waits for ready', async () => {
	const previous = process.env.FOUNT_TEST_HUB_URL
	const handle = await startTestKernel({
		port: KERNEL_PORT + 5,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	process.env.FOUNT_TEST_HUB_URL = handle.url
	try {
		const first = await acquireModuleCheckTicket()
		let second
		const pending = acquireModuleCheckTicket().then(ticket => { second = ticket })
		await new Promise(resolve => setTimeout(resolve, 30))
		assertEquals(second, undefined)
		await signalModuleCheckReady(first)
		await pending
		assertEquals(Boolean(second), true)
		await signalModuleCheckReady(second)
	}
	finally {
		await handle.close()
		if (previous === undefined) delete process.env.FOUNT_TEST_HUB_URL
		else process.env.FOUNT_TEST_HUB_URL = previous
	}
})
