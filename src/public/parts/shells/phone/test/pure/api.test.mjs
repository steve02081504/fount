/**
 * 手机 Shell 设备管理器单元测试。
 */
/* global Deno */
import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert'

import {
	execOnDevice,
	getFrame,
	getState,
	getUserManager,
	listDevices,
} from '../../src/api.mjs'

/**
 * 伪造一条已连接的 WebSocket。
 * @returns {{ OPEN: number, readyState: number, sent: object[], send: (text: string) => void }} 假 socket
 */
function fakeSocket() {
	return {
		OPEN: 1,
		readyState: 1,
		sent: [],
		/**
		 * 记录发往设备的消息。
		 * @param {string} text JSON 文本
		 * @returns {void}
		 */
		send(text) { this.sent.push(JSON.parse(text)) },
	}
}

let sequence = 0

/**
 * 造一个隔离的用户名，避免各测试共享设备表。
 * @returns {string} 用户名
 */
function freshUser() {
	sequence++
	return `phone-test-${sequence}-${Date.now()}`
}

Deno.test('注册后可用 listDevices 查到设备摘要', () => {
	const username = freshUser()
	const manager = getUserManager(username)
	const device = manager.registerDevice(
		fakeSocket(),
		{ deviceId: 'd1', name: 'Pixel', androidVersion: 35, capabilities: ['accessibility'] },
	)

	assertEquals(device.deviceId, 'd1')
	const list = listDevices(username)
	assertEquals(list.length, 1)
	assertEquals(list[0].connected, true)
	assertEquals(list[0].name, 'Pixel')
	assertEquals(list[0].capabilities, ['accessibility'])
})

Deno.test('同 deviceId 重连复用条目并清除断开时间', () => {
	const username = freshUser()
	const manager = getUserManager(username)
	manager.registerDevice(fakeSocket(), { deviceId: 'd1' })
	const connectedAt = listDevices(username)[0].connectedAt.getTime()
	manager.markDisconnected('d1')
	assertEquals(listDevices(username)[0].connected, false)

	const reconnected = fakeSocket()
	manager.registerDevice(reconnected, { deviceId: 'd1', name: 'Pixel 2' })

	assertEquals(listDevices(username).length, 1)
	assertEquals(listDevices(username)[0].connected, true)
	assertEquals(listDevices(username)[0].name, 'Pixel 2')
	assertEquals(listDevices(username)[0].connectedAt.getTime(), connectedAt)
})

Deno.test('上下文按类别留存，frame/state 取最新', () => {
	const username = freshUser()
	const manager = getUserManager(username)
	manager.registerDevice(fakeSocket(), { deviceId: 'd1' })

	manager.updateContext('d1', { kind: 'screen', payload: { ts: 1, package: 'com.a', screenshot: 'AAA' } })
	manager.updateContext('d1', { kind: 'camera', facing: 'front', payload: { ts: 2, frame: 'FRONT' } })
	manager.updateContext('d1', { kind: 'camera', facing: 'back', payload: { ts: 3, frame: 'BACK' } })

	assertEquals(getFrame(username, 'd1', 'screen').base64, 'AAA')
	assertEquals(getFrame(username, 'd1', 'screen').mimeType, 'image/jpeg')
	assertEquals(getFrame(username, 'd1', 'front').base64, 'FRONT')
	assertEquals(getFrame(username, 'd1', 'back').base64, 'BACK')

	const state = getState(username, 'd1')
	assertEquals(state.screen.package, 'com.a')
	assertEquals(state.screen.screenshot, '<omitted>')
	assertEquals(state.camera, { front: 1, back: 1 })
})

Deno.test('屏幕上下文只保留最近三帧', () => {
	const username = freshUser()
	const manager = getUserManager(username)
	manager.registerDevice(fakeSocket(), { deviceId: 'd1' })

	for (let index = 0; index < 5; index++)
		manager.updateContext('d1', { kind: 'screen', payload: { ts: index, screenshot: `S${index}` } })

	assertEquals(getState(username, 'd1').screenFrameCount, 3)
	assertEquals(getFrame(username, 'd1', 'screen').base64, 'S4')
})

Deno.test('sendRequest 把设备响应结算回 Promise', async () => {
	const username = freshUser()
	const manager = getUserManager(username)
	const ws = fakeSocket()
	manager.registerDevice(ws, { deviceId: 'd1' })

	const pending = manager.sendRequest('d1', 'eval', { language: 'java', source: 'return 1;' }, 2000)
	assertEquals(ws.sent.length, 1)
	assertEquals(ws.sent[0].type, 'cmd')
	assertEquals(ws.sent[0].tool, 'eval')
	assertEquals(ws.sent[0].args.source, 'return 1;')

	manager.settleRequest(ws.sent[0].requestId, false, { result: '1' })
	assertEquals(await pending, { result: '1' })
})

Deno.test('错误响应与设备断开都会拒绝 pending', async () => {
	const username = freshUser()
	const manager = getUserManager(username)
	const ws = fakeSocket()
	manager.registerDevice(ws, { deviceId: 'd1' })

	const errored = manager.sendRequest('d1', 'eval', {}, 2000)
	manager.settleRequest(ws.sent[0].requestId, true, { error: '编译失败' })
	await assertRejects(() => errored, Error, '编译失败')

	const interrupted = manager.sendRequest('d1', 'eval', {}, 2000)
	manager.markDisconnected('d1')
	await assertRejects(() => interrupted, Error, '设备已断开: d1')
})

Deno.test('pickDevice 在没有在线设备时抛 404', () => {
	const username = freshUser()
	const error = assertThrows(() => getFrame(username, undefined, 'screen'), Error)
	assertEquals(error.http_code, 404)
})

Deno.test('execOnDevice 校验 source 并保留默认参数', async () => {
	const username = freshUser()
	const manager = getUserManager(username)

	const missing = assertThrows(() => execOnDevice(username, {}), Error)
	assertEquals(missing.http_code, 400)

	const ws = fakeSocket()
	manager.registerDevice(ws, { deviceId: 'd1' })
	const pending = execOnDevice(username, { source: 'return 2;', timeoutMs: 2000 })
	assertEquals(ws.sent[0].args.language, 'java')
	assertEquals(ws.sent[0].args.persist, null)
	assertEquals(ws.sent[0].args.timeoutMs, 2000)

	manager.settleRequest(ws.sent[0].requestId, false, { result: '2' })
	assertEquals(await pending, { result: '2' })
})
