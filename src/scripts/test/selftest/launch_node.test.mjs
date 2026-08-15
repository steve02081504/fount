/**
 * launchNode：worker 提前退出须迅速失败；就绪后 stop 不得再报 before-ready。
 */
/* global Deno */
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { launchNode, stopNode } from '../node/launch.mjs'

const crashBeforeReady = fileURLToPath(new URL('./crash_before_ready_bootstrap.mjs', import.meta.url))
const crashAfterReady = fileURLToPath(new URL('./crash_after_ready_bootstrap.mjs', import.meta.url))

/**
 * @param {Promise<unknown>} promise 待监视的启动
 * @param {number} ms 超时
 * @returns {Promise<unknown>} 原结果或超时拒绝
 */
function rejectIfHung(promise, ms) {
	let timer
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`launchNode hung (${ms}ms)`)), ms)
		}),
	])
}

Deno.test('launchNode rejects promptly when worker exits before ready JSON', async () => {
	await assertRejects(
		() => rejectIfHung(launchNode({
			p2p: false,
			minP2pNode: true,
			bootstrap: crashBeforeReady,
		}), 20_000),
		Error,
		'before ready',
	)
})

Deno.test('launchNode rejects promptly when worker dies during ping', async () => {
	await assertRejects(
		() => rejectIfHung(launchNode({
			p2p: false,
			minP2pNode: true,
			bootstrap: crashAfterReady,
		}), 20_000),
		Error,
		'before ready',
	)
})

Deno.test('stopNode after ready does not reject as worker exited before ready', async () => {
	/** @type {unknown[]} */
	const rejections = []
	/**
	 * @param {unknown} reason 拒绝原因
	 * @returns {void}
	 */
	const onReject = reason => { rejections.push(reason) }
	process.on('unhandledRejection', onReject)
	try {
		const node = await launchNode({ p2p: false, minP2pNode: true })
		await stopNode(node)
		await new Promise(resolve => setTimeout(resolve, 200))
		assertEquals(
			rejections.map(reason => String(reason?.message ?? reason)).filter(message => message.includes('before ready')),
			[],
		)
	}
	finally {
		process.off('unhandledRejection', onReject)
	}
})
