/**
 * page watch 纯逻辑：WatchLoop / reporter / ariaIgnoreProblem。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { ariaIgnoreProblem } from '../core/aria_ignore.mjs'
import { WatchLoop } from '../../../public/pages/scripts/test/watch/loop.mjs'
import { createReporter } from '../../../public/pages/scripts/test/watch/reporter.mjs'

/**
 * 等到谓词为真或超时。
 * @param {() => boolean} pred 谓词
 * @param {number} [timeoutMs=2000] 超时
 * @returns {Promise<void>}
 */
async function waitUntil(pred, timeoutMs = 2000) {
	const start = Date.now()
	while (!pred()) {
		if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out')
		await new Promise(resolve => setTimeout(resolve, 5))
	}
}

/**
 * 静默 reporter（不写 console）。
 * @returns {import('../../../public/pages/scripts/test/watch/reporter.mjs').WatchReporter}
 */
function silentReporter() {
	return { report() { } }
}

Deno.test('createReporter dedups by key', () => {
	/** @type {unknown[][]} */
	const logged = []
	const orig = console.error
	console.error = (...args) => { logged.push(args) }
	try {
		const reporter = createReporter('[test:x]')
		reporter.report('a', 'one')
		reporter.report('a', 'two')
		reporter.report('b', 'three')
		assertEquals(logged.length, 2)
		assertEquals(logged[0], ['[test:x]', 'one'])
		assertEquals(logged[1], ['[test:x]', 'three'])
	}
	finally {
		console.error = orig
	}
})

Deno.test('ariaIgnoreProblem covers missing / bad / closed', () => {
	assertEquals(ariaIgnoreProblem({ url: '', where: '#x' })?.code, 'missing-url')
	assertEquals(ariaIgnoreProblem({ url: 'https://example.com/1', where: '#x' })?.code, 'bad-url')
	assertEquals(
		ariaIgnoreProblem({
			url: 'https://github.com/josdejong/svelte-jsoneditor/issues/584',
			where: '#x',
			closed: false,
		}),
		null,
	)
	assertEquals(
		ariaIgnoreProblem({
			url: 'https://github.com/josdejong/svelte-jsoneditor/issues/584',
			where: '#x',
			closed: true,
		})?.code,
		'closed',
	)
	assertEquals(
		ariaIgnoreProblem({ url: '', where: '#box' })?.message,
		'#box: aria-ignore requires a GitHub issue URL',
	)
	assertEquals(
		ariaIgnoreProblem({ url: 'not-a-url', where: 'DIV' })?.message,
		'DIV: bad aria-ignore URL not-a-url',
	)
	assertEquals(
		ariaIgnoreProblem({
			url: 'https://github.com/a/b/issues/1',
			where: '#el',
			closed: true,
		})?.message,
		'#el: issue closed — remove aria-ignore (https://github.com/a/b/issues/1)',
	)
})

Deno.test('WatchLoop wake/drain are no-ops before start', async () => {
	const loop = new WatchLoop({ reporter: silentReporter() })
	let runs = 0
	loop.register({
		name: 'noop',
		delayMs: 1,
		run: () => { runs++; return true },
		covered: () => true,
	})
	loop.wake()
	await loop.drain()
	await new Promise(resolve => setTimeout(resolve, 30))
	assertEquals(runs, 0)
	assertEquals(loop.started, false)
})

Deno.test('WatchLoop rotates tasks and parks after full idle round', async () => {
	const loop = new WatchLoop({ reporter: silentReporter() })
	/** @type {string[]} */
	const order = []
	let aIdle = false
	let bIdle = false
	loop.register({
		name: 'a',
		delayMs: 1,
		run: () => {
			order.push('a')
			if (aIdle) return true
			aIdle = true
			return false
		},
		covered: () => true,
	})
	loop.register({
		name: 'b',
		delayMs: 1,
		run: () => {
			order.push('b')
			if (bIdle) return true
			bIdle = true
			return false
		},
		covered: () => true,
	})
	loop.start()
	await waitUntil(() => order.filter(name => name === 'a').length >= 2 && order.filter(name => name === 'b').length >= 2)
	const afterPark = order.length
	await new Promise(resolve => setTimeout(resolve, 40))
	assertEquals(order.length, afterPark, 'parked loop must not keep ticking')
	loop.wake()
	await waitUntil(() => order.length > afterPark)
})

Deno.test('WatchLoop wake during running is not dropped', async () => {
	const loop = new WatchLoop({ reporter: silentReporter() })
	/** @type {(() => void) | null} */
	let release = null
	let runs = 0
	loop.register({
		name: 'blocker',
		delayMs: 1,
		run: async () => {
			runs++
			if (runs === 1)
				await new Promise(resolve => { release = resolve })
			return true
		},
		covered: () => true,
	})
	loop.start()
	await waitUntil(() => release !== null)
	loop.wake()
	release?.()
	await waitUntil(() => runs >= 2)
})

Deno.test('WatchLoop drain waits until all covered', async () => {
	const loop = new WatchLoop({ reporter: silentReporter() })
	/** @type {Set<string>} */
	const seen = new Set()
	loop.register({
		name: 'cover',
		delayMs: 1,
		beginDrain: () => { seen.clear() },
		run: ({ draining }) => {
			if (!draining) return true
			if (!seen.has('x')) { seen.add('x'); return false }
			if (!seen.has('y')) { seen.add('y'); return false }
			return true
		},
		covered: () => seen.has('x') && seen.has('y'),
	})
	loop.start()
	await loop.drain()
	assertEquals([...seen].sort(), ['x', 'y'])
})

Deno.test('WatchLoop reports task failures via reporter', async () => {
	/** @type {unknown[][]} */
	const logged = []
	const orig = console.error
	console.error = (...args) => { logged.push(args) }
	try {
		const reporter = createReporter('[test:watch]')
		const loop = new WatchLoop({ reporter })
		loop.register({
			name: 'boom',
			delayMs: 1,
			run: () => { throw new Error('kaboom') },
			covered: () => true,
		})
		loop.start()
		await waitUntil(() => logged.some(line => line.includes('tick-failed')))
		assertEquals(logged[0][0], '[test:watch]')
		assertEquals(logged[0][1], 'tick-failed')
		assertEquals(logged[0][2], 'boom')
	}
	finally {
		console.error = orig
	}
})

Deno.test('WatchLoop concurrent drain shares one waiter list', async () => {
	const loop = new WatchLoop({ reporter: silentReporter() })
	let pass = 0
	loop.register({
		name: 'once',
		delayMs: 1,
		beginDrain: () => { pass = 0 },
		run: ({ draining }) => {
			if (!draining) return true
			pass++
			return false
		},
		covered: () => pass >= 1,
	})
	loop.start()
	await Promise.all([loop.drain(), loop.drain()])
	assertEquals(pass >= 1, true)
})
