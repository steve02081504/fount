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

/**
 * 等一个类型的事件。
 * @param {WebSocket} ws socket
 * @param {string} type 事件类型
 * @returns {Promise<object>} 事件对象
 */
function waitEvent(ws, type) {
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
		/** @returns {void} */
		const cleanup = () => {
			ws.removeEventListener('message', onMessage)
			ws.removeEventListener('close', onClose)
		}
		ws.addEventListener('message', onMessage)
		ws.addEventListener('close', onClose)
	})
}

/**
 * 一轮 viewer 生命周期。
 * @param {string} url WS URL
 * @returns {Promise<{ connect: number, helloAccepted: number, close: number, total: number }>} 耗时
 */
async function cycleOnce(url) {
	const t0 = performance.now()
	const ws = new WebSocket(url)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', () => reject(new Error(`cannot connect ${url}`)), { once: true })
	})
	const connectMs = performance.now() - t0

	const accepted = waitEvent(ws, 'accepted')
	const helloStart = performance.now()
	ws.send(JSON.stringify({ type: 'hello', watch: true }))
	await accepted
	const helloAcceptedMs = performance.now() - helloStart

	const closeStart = performance.now()
	await new Promise(resolve => {
		if (ws.readyState === WebSocket.CLOSED) return resolve()
		ws.addEventListener('close', resolve, { once: true })
		ws.close()
	})
	const closeMs = performance.now() - closeStart

	return { connect: connectMs, helloAccepted: helloAcceptedMs, close: closeMs, total: performance.now() - t0 }
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