/**
 * viewer 启动/收尾速度基准：WS 连接 → hello → accepted → 关闭 的往返拆分。
 *
 * 需要先有内核（自动 ensure；跑完可 shutdown）。每轮一次独立 viewer 生命周期。
 *
 * 用法（仓库根）：
 *   deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/viewer_cycle.mjs [迭代次数=5] [--shutdown]
 */
import process from 'node:process'

import { testHubUrl } from '../../hub/index.mjs'
import { ensureTestKernel, shutdownTestKernel } from '../../kernel/ensure.mjs'

import { fmt, renderTable, row } from './common.mjs'

const ITERATIONS = Math.max(1, Number(process.argv[2]) || 5)
const SHUTDOWN_AFTER = process.argv.includes('--shutdown')

/** 单次事件等待的显式超时（毫秒）。 */
const EVENT_TIMEOUT_MS = 5000

/**
 * 等一个类型的事件。
 * @param {WebSocket} socket socket
 * @param {string} type 事件类型
 * @returns {Promise<object>} 事件对象
 */
function waitEvent(socket, type) {
	return new Promise((resolve, reject) => {
		/**
		 * 处理收到的事件，类型匹配则完成等待。
		 * @param {MessageEvent} event WS 消息事件
		 * @returns {void}
		 */
		const onMessage = event => {
			let message
			try {
				message = JSON.parse(String(event.data))
			}
			catch {
				return
			}
			if (message.type !== type) return
			cleanup()
			resolve(message)
		}
		/**
		 * 连接提前关闭则拒绝等待。
		 * @returns {void}
		 */
		const onClose = () => {
			cleanup()
			reject(new Error(`ws closed before ${type}`))
		}
		/**
		 * 超时未等到则移除监听并拒绝等待。
		 * @returns {void}
		 */
		const onTimeout = () => {
			cleanup()
			socket.close()
			reject(new Error(`timeout waiting for ${type}`))
		}
		/** @returns {void} */
		const cleanup = () => {
			clearTimeout(timer)
			socket.removeEventListener('message', onMessage)
			socket.removeEventListener('close', onClose)
		}
		const timer = setTimeout(onTimeout, EVENT_TIMEOUT_MS)
		socket.addEventListener('message', onMessage)
		socket.addEventListener('close', onClose)
	})
}

/**
 * 一轮 viewer 生命周期。
 * @param {string} url WS URL
 * @returns {Promise<{ connect: number, helloAccepted: number, close: number, total: number }>} 耗时
 */
async function cycleOnce(url) {
	const cycleStart = performance.now()
	const socket = new WebSocket(url)
	await new Promise((resolve, reject) => {
		/** 移除 open/error/timeout 监听并清除定时器。 @returns {void} */
		const cleanup = () => {
			clearTimeout(timer)
			socket.removeEventListener('open', onOpen)
			socket.removeEventListener('error', onError)
			socket.removeEventListener('timeout', onTimeout)
		}
		/** 连接成功则完成等待。 @returns {void} */
		const onOpen = () => {
			cleanup()
			resolve()
		}
		/** 连接失败则拒绝等待。 @returns {void} */
		const onError = () => {
			cleanup()
			reject(new Error(`cannot connect ${url}`))
		}
		/** 握手超时：关闭 socket 并拒绝等待。 @returns {void} */
		const onTimeout = () => {
			cleanup()
			socket.close()
			reject(new Error(`timeout connecting ${url}`))
		}
		const timer = setTimeout(onTimeout, EVENT_TIMEOUT_MS)
		socket.addEventListener('open', onOpen, { once: true })
		socket.addEventListener('error', onError, { once: true })
		socket.addEventListener('timeout', onTimeout, { once: true })
	})
	const connectMs = performance.now() - cycleStart

	const accepted = waitEvent(socket, 'accepted')
	const helloStart = performance.now()
	socket.send(JSON.stringify({ type: 'hello', watch: true }))
	await accepted
	const helloAcceptedMs = performance.now() - helloStart

	const closeStart = performance.now()
	await new Promise((resolve, reject) => {
		if (socket.readyState === WebSocket.CLOSED) return resolve()
		/** @returns {void} */
		const onClose = () => {
			clearTimeout(timer)
			resolve()
		}
		/** @returns {void} */
		const onTimeout = () => {
			socket.removeEventListener('close', onClose)
			reject(new Error('timeout waiting for close handshake'))
		}
		const timer = setTimeout(onTimeout, EVENT_TIMEOUT_MS)
		socket.addEventListener('close', onClose, { once: true })
		socket.close()
	})
	const closeMs = performance.now() - closeStart

	return { connect: connectMs, helloAccepted: helloAcceptedMs, close: closeMs, total: performance.now() - cycleStart }
}

const url = `${testHubUrl().replace(/^http/, 'ws')}/ws/viewer`
await ensureTestKernel()
console.log(`viewer cycle bench — ${ITERATIONS} 次（watch viewer：connect→hello→accepted→close）`)
console.log('')

/** @type {{ connect: number, helloAccepted: number, close: number, total: number }[]} */
const runs = []
for (let i = 0; i < ITERATIONS; i++) {
	const result = await cycleOnce(url)
	runs.push(result)
	console.log(`  #${i + 1}: total ${fmt(result.total)}ms  connect ${fmt(result.connect)}ms  hello→accepted ${fmt(result.helloAccepted)}ms  close ${fmt(result.close)}ms`)
}

/**
 * 提取某相位名的耗时样本数组。
 * @param {string} key 相位键
 * @returns {number[]} 样本
 */
const pick = key => runs.map(r => r[key])
console.log(renderTable('viewer 生命周期（min / 中位 / max）', [
	{ name: 'total', samples: pick('total') },
	{ name: 'connect', samples: pick('connect') },
	{ name: 'hello→accepted', samples: pick('helloAccepted') },
	{ name: 'close', samples: pick('close') },
]))

console.log('')
console.log('总计：', row(pick('total')), 'ms（min / 中位 / max）')

if (SHUTDOWN_AFTER)
	await shutdownTestKernel()
