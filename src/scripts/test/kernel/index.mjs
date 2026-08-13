/**
 * 测试内核进程入口：独占 hub 口；EADDRINUSE 则立刻以 0 退出。
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { TEST_HUB_PORT } from '../hub/index.mjs'

import { startTestKernel } from './server.mjs'

const port = Number(process.env.FOUNT_TEST_HUB_PORT) || TEST_HUB_PORT

try {
	const handle = await startTestKernel({
		port,
		autoExit: process.env.FOUNT_TEST_KERNEL_NO_EXIT !== '1',
		watchFs: process.env.FOUNT_TEST_KERNEL_WATCH_FS !== '0',
	})
	await handle.closed
	process.exit(0)
}
catch (error) {
	if (error?.code === 'EADDRINUSE')
		process.exit(0)
	console.error(error)
	process.exit(1)
}
