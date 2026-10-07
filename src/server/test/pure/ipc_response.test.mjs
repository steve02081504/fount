/* global Deno */
/* eslint-disable jsdoc/require-jsdoc */
import net from 'node:net'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { IPCManager } from '../../ipc_server/index.mjs'

async function withPeer(onConnection, run) {
	const sockets = new Set()
	const server = net.createServer(socket => {
		sockets.add(socket)
		socket.on('close', () => sockets.delete(socket))
		onConnection(socket)
	})
	await new Promise(resolve => server.listen(0, 'localhost', resolve))
	try { await run(server.address().port) }
	finally {
		for (const socket of sockets) socket.destroy()
		await new Promise(resolve => server.close(resolve))
	}
}

Deno.test('IPC caller rejects a peer that closes without a response', async () => {
	await withPeer(socket => socket.end(), async port => {
		await assertRejects(() => IPCManager.sendCommand('ping', {}, { port, timeoutMs: 1000 }), Error, 'closed before a complete response')
	})
})

Deno.test('IPC caller times out a peer that never responds', async () => {
	await withPeer(() => {}, async port => {
		await assertRejects(() => IPCManager.sendCommand('ping', {}, { port, timeoutMs: 50 }), Error, 'timed out')
	})
})

Deno.test('IPC caller accepts a framed response', async () => {
	await withPeer(socket => socket.on('data', () => socket.write('{"status":"ok","data":"pong"}\n')), async port => {
		assertEquals(await IPCManager.sendCommand('ping', {}, { port }), 'pong')
	})
})
