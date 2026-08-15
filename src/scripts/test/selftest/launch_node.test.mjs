/**
 * launchNode：worker 提前退出须迅速失败；就绪后 stop 不得再报 before-ready。
 * 三步必须串行，避免并行 launchNode 互抢模组检查闸和端口。
 */
/* global Deno */
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { launchNode, stopNode } from '../node/launch.mjs'

const crashBeforeReady = fileURLToPath(new URL('./crash_before_ready_bootstrap.mjs', import.meta.url))
const crashAfterReady = fileURLToPath(new URL('./crash_after_ready_bootstrap.mjs', import.meta.url))

Deno.test('launchNode worker exit and stopNode', async () => {
	await assertRejects(
		() => launchNode({
			p2p: false,
			minP2pNode: true,
			bootstrap: crashBeforeReady,
		}),
		Error,
		'before ready',
	)
	await assertRejects(
		() => launchNode({
			p2p: false,
			minP2pNode: true,
			bootstrap: crashAfterReady,
		}),
		Error,
		'before ready',
	)

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
