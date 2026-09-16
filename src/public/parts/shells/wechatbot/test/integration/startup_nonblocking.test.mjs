/**
 * WeChat bot 启动回归：长轮询主循环（OnceClientReady，直到 abort 才退出）不得阻塞启动。
 * 启动必须解析出句柄，使 botCache 存实例而非 pending Promise——否则关闭时 pauseBot 会永久挂起，
 * 整个 on-shutdown 钩子链无法完成，进程无法重启/退出（tray 重启失效的根因）。
 */
/* global Deno */
import { assert } from 'jsr:@std/assert'

import { createCharBoot } from '../../../chat/test/harness.mjs'

Deno.test('wechatbot startBot resolves despite long-running OnceClientReady loop', async () => {
	const username = `wx-nonblock-${crypto.randomUUID().slice(0, 8)}`
	const boot = createCharBoot({ username })
	await boot.ensureServer()

	const { startBot } = await import('../../src/bot.mjs')

	let loopStarted = false
	let loopAborted = false
	const fakeChar = {
		interfaces: {
			wechat: {
				/**
				 * 模拟真实实现：主循环直到 abort 才退出。
				 * @param {{ signal: AbortSignal }} context 运行上下文
				 * @returns {Promise<void>}
				 */
				OnceClientReady: context => {
					loopStarted = true
					return new Promise(resolve => {
						context.signal.addEventListener('abort', () => { loopAborted = true; resolve() }, { once: true })
					})
				},
			},
		},
	}

	/** @type {number | undefined} */
	let timer
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error('startBot blocked on OnceClientReady')), 3000)
	})

	let handle
	try {
		handle = await Promise.race([
			startBot(
				{ token: 'test-token', apiBaseUrl: 'https://example.invalid', config: {} },
				fakeChar, username, 'urlChar', 'nonblock-bot',
			),
			timeout,
		])
	}
	finally {
		clearTimeout(timer)
	}

	assert(loopStarted, 'OnceClientReady should have been invoked')
	assert(typeof handle?.destroy === 'function', 'startBot should resolve with a destroy handle')

	await handle.destroy()
	assert(loopAborted, 'destroy should abort the polling loop')
})
