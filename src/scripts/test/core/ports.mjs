import net from 'node:net'

import { resolveListenBind } from '../../net_listen.mjs'

/** 测试节点首选 TCP 端口（自该值向上扫描空闲口；故意避开生产默认口 8931）。 */
export const TEST_PORT_BASE = 28931

/** headless 集成测试 config.json 占位 port（Web: false 时不 bind；与 live 口错开）。 */
export const HEADLESS_CONFIG_PORT = TEST_PORT_BASE + 10_000

/** 测试 IPC 扫描起点（避开生产 16698）。 */
export const TEST_IPC_PORT_BASE = 36_698

/**
 * 检测本机端口是否可监听。
 * @param {number} port 待检测端口
 * @returns {Promise<boolean>} 127.0.0.1 上是否可监听
 */
function isTcpPortFree(port) {
	return new Promise(resolve => {
		const server = net.createServer()
		server.unref()
		server.on('error', () => resolve(false))
		server.listen(resolveListenBind(null, port), () => {
			server.close(() => resolve(true))
		})
	})
}

/**
 * 从首选端口起向上扫描，返回第一个空闲 IPC 口。
 * @param {number} [preferred=TEST_IPC_PORT_BASE] 首选端口
 * @param {number} [scan=50] 扫描宽度
 * @returns {Promise<number>} 可用端口
 */
export async function pickAvailableIpcPort(preferred = TEST_IPC_PORT_BASE, scan = 50) {
	for (let offset = 0; offset < scan; offset++) {
		const port = preferred + offset
		if (await isTcpPortFree(port)) return port
	}
	throw new Error(`no free IPC TCP port from ${preferred} (+${scan})`)
}
