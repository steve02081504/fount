/**
 * Ephemeral MQTT-over-WebSocket broker for federation live tests.
 * Replaces the public broker.emqx.io dependency with a local ws:// relay.
 */
import { createServer } from 'node:http'

import { pickAvailablePort } from '../node/launch.mjs'

/** @type {{ httpServer: import('node:http').Server, wsServer: object, broker: object, relayUrl: string } | null} */
let activeBroker = null
/** 引用计数：多个并发 fed 套件共享同一 broker 实例，最后一个 stop 才真正关闭。 */
let brokerRefCount = 0

/**
 * 启动（或复用）本地 MQTT-over-WebSocket broker。
 * 引用计数递增；多个并发 fed 套件调用时返回同一个 URL。
 * @returns {Promise<{ relayUrl: string, port: number }>} broker 连接 URL 与端口
 */
export async function startTestMqttBroker() {
	brokerRefCount++
	if (activeBroker)
		return { relayUrl: activeBroker.relayUrl, port: Number(new URL(activeBroker.relayUrl).port) }

	const { Aedes } = await import('npm:aedes')
	const websocket = (await import('npm:websocket-stream')).default
	const broker = await Aedes.createBroker()
	const port = await pickAvailablePort(18_883)
	const httpServer = createServer()
	const wsServer = websocket.createServer({ server: httpServer, path: '/mqtt' }, stream => {
		broker.handle(stream)
	})

	await new Promise((resolve, reject) => {
		httpServer.once('error', reject)
		httpServer.listen(port, '127.0.0.1', resolve)
	})

	const relayUrl = `ws://127.0.0.1:${port}/mqtt`
	activeBroker = { httpServer, wsServer, broker, relayUrl }
	return { relayUrl, port }
}

/**
 * 释放本 suite 对 broker 的引用；引用归零时才真正关闭。
 * @returns {Promise<void>}
 */
export async function stopTestMqttBroker() {
	brokerRefCount = Math.max(0, brokerRefCount - 1)
	if (brokerRefCount > 0 || !activeBroker) return
	const { httpServer, wsServer, broker } = activeBroker
	activeBroker = null
	await new Promise(resolve => { wsServer.close(() => resolve()) })
	await new Promise(resolve => { httpServer.close(() => resolve()) })
	await new Promise(resolve => { broker.close(() => resolve()) })
}
