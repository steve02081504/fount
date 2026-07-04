/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { DEFAULT_ICE_SERVERS } from '../../ice_servers.mjs'
import { configureBufferedAmountLowThreshold, onBufferedAmountLow, readBufferedAmount } from '../../link/channel_mux.mjs'
import { createLink } from '../../link/link.mjs'
import { waitForChannelState } from '../../link/rtc.mjs'
import { createSignalPair, identity } from './helpers.mjs'

/**
 * @param {RTCDataChannel} channel
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function waitForMessage(channel, timeoutMs) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`message timeout after ${timeoutMs}ms`)), timeoutMs)
		const handler = event => {
			clearTimeout(timer)
			const data = event?.data
			if (typeof data === 'string') resolve(data)
			else if (data instanceof Uint8Array) resolve(new TextDecoder().decode(data))
			else if (data instanceof ArrayBuffer) resolve(new TextDecoder().decode(new Uint8Array(data)))
			else resolve(String(data))
		}
		channel.addEventListener?.('message', handler)
		channel.onmessage = handler
		channel.onMessage?.subscribe(msg => handler({ data: msg }))
	})
}

/**
 * @param {RTCDataChannel} channel
 * @returns {Promise<void>}
 */
function waitForBufferedAmountLow(channel, timeoutMs) {
	return new Promise((resolve, reject) => {
		const stop = onBufferedAmountLow(channel, () => {
			clearTimeout(timer)
			stop()
			resolve()
		})
		const timer = setTimeout(() => {
			stop()
			reject(new Error(`bufferedamountlow timeout after ${timeoutMs}ms`))
		}, timeoutMs)
	})
}

Deno.test({
	name: 'node-datachannel exposes bufferedamountlow backpressure signals',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const alice = identity(31)
		const bob = identity(32)
		const signals = createSignalPair()
		const aliceLink = await createLink({
			nodeHash: bob.nodeHash,
			initiator: true,
			signal: signals.left,
			iceServers: DEFAULT_ICE_SERVERS,
			localIdentity: alice,
		})
		const bobLink = await createLink({
			nodeHash: alice.nodeHash,
			initiator: false,
			signal: signals.right,
			iceServers: DEFAULT_ICE_SERVERS,
			localIdentity: bob,
		})
		try {
			await Promise.all([aliceLink.ready, bobLink.ready])
			const sender = aliceLink.channel('bulk')
			const receiver = bobLink.channel('bulk')
			if (!sender || !receiver) throw new Error('bulk channel unavailable after link ready')
			await Promise.all([waitForChannelState(sender, 'open', 30_000), waitForChannelState(receiver, 'open', 30_000)])
			const basicMessage = waitForMessage(sender, 10_000)
			receiver.send(new TextEncoder().encode('backpressure-ready'))
			assertEquals(await basicMessage, 'backpressure-ready')
			const threshold = 256 * 1024
			assertEquals(configureBufferedAmountLowThreshold(sender, threshold), threshold)
			const lowPromise = waitForBufferedAmountLow(sender, 30_000)
			const chunk = new Uint8Array(128 * 1024)
			let maxBuffered = 0
			let sends = 0
			while (maxBuffered <= threshold && sends < 256) {
				sender.send(chunk)
				maxBuffered = Math.max(maxBuffered, readBufferedAmount(sender))
				sends++
			}
			assertEquals(maxBuffered > threshold, true, `buffer never exceeded threshold: max=${maxBuffered}, threshold=${threshold}`)
			await lowPromise
			assertEquals(maxBuffered > 0, true)
		}
		finally {
			await aliceLink.close('test-done')
			await bobLink.close('test-done')
		}
	},
})
