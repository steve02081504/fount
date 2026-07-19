/**
 * listen 双栈绑定解析与端口探测。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	closeHeldServers,
	holdListenPort,
	isListenPortFree,
	isLoopbackListen,
	resolveListenBind,
	resolveListenBinds,
} from '../../../scripts/net_listen.mjs'

Deno.test('resolveListenBinds dual-stacks null and localhost', () => {
	assertEquals(resolveListenBinds(null, 8931), [
		{ port: 8931, host: '0.0.0.0' },
		{ port: 8931, host: '::', ipv6Only: true },
	])
	assertEquals(resolveListenBinds('localhost', 8931), [
		{ port: 8931, host: '127.0.0.1' },
		{ port: 8931, host: '::1', ipv6Only: true },
	])
	assertEquals(resolveListenBinds('192.168.1.1', 80), [{ port: 80, host: '192.168.1.1' }])
	assertEquals(resolveListenBind(null, 1), { port: 1, host: '0.0.0.0' })
	assertEquals(isLoopbackListen('localhost'), true)
	assertEquals(isLoopbackListen(null), false)
})

Deno.test('isListenPortFree / holdListenPort round-trip', async () => {
	const port = 38931
	assertEquals(await isListenPortFree(port), true)
	const held = await holdListenPort(port)
	assertEquals(held.length >= 1, true)
	assertEquals(await isListenPortFree(port), false)
	await closeHeldServers(held)
	assertEquals(await isListenPortFree(port), true)
})
