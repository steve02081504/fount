/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { configureBufferedAmountLowThreshold, readBufferedAmount } from '../../link/channel_mux.mjs'
import { attachDataChannelListener, attachIceCandidateListener, loadNodeRtcPolyfill, waitForChannelState } from '../../link/rtc.mjs'
import { DEFAULT_ICE_SERVERS } from '../../ice_servers.mjs'

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
function waitForBufferedAmountLow(channel) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('bufferedamountlow timeout after 10000ms')), 10_000)
		const handler = () => {
			clearTimeout(timer)
			resolve()
		}
		channel.addEventListener?.('bufferedamountlow', handler)
		if (channel.bufferedAmountLow?.subscribe)
			channel.bufferedAmountLow.subscribe(handler)
	})
}

Deno.test({
	name: 'node-datachannel exposes bufferedamountlow backpressure signals',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const rtc = await loadNodeRtcPolyfill()
		const left = new rtc.RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })
		const right = new rtc.RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })
		attachIceCandidateListener(left, event => {
			if (event.candidate) void right.addIceCandidate(event.candidate).catch(() => {})
		})
		attachIceCandidateListener(right, event => {
			if (event.candidate) void left.addIceCandidate(event.candidate).catch(() => {})
		})
		const sender = left.createDataChannel('bulk')
		let receiverResolve
		let receiverReject
		const receiverPromise = new Promise(resolve => { receiverResolve = resolve })
		const receiverTimeout = setTimeout(() => receiverReject?.(new Error('remote datachannel timeout after 30000ms')), 30_000)
		const receiverGate = new Promise((resolve, reject) => {
			receiverResolve = resolve
			receiverReject = reject
		})
		attachDataChannelListener(right, event => receiverResolve(event.channel))
		try {
			const offer = await left.createOffer()
			await left.setLocalDescription(offer)
			await right.setRemoteDescription(offer)
			const answer = await right.createAnswer()
			await right.setLocalDescription(answer)
			await left.setRemoteDescription(answer)
			const receiver = await receiverGate
			clearTimeout(receiverTimeout)
			receiver.onmessage = () => {}
			await Promise.all([waitForChannelState(sender, 'open', 30_000), waitForChannelState(receiver, 'open', 30_000)])
			const basicMessage = waitForMessage(sender, 10_000)
			receiver.send(new TextEncoder().encode('backpressure-ready'))
			assertEquals(await basicMessage, 'backpressure-ready')
			assertEquals(configureBufferedAmountLowThreshold(sender, 256 * 1024), 256 * 1024)
			const lowPromise = waitForBufferedAmountLow(sender)
			const chunk = new Uint8Array(64 * 1024)
			let maxBuffered = 0
			for (let i = 0; i < 64; i++) {
				sender.send(chunk)
				maxBuffered = Math.max(maxBuffered, readBufferedAmount(sender))
				if (maxBuffered > 1024 * 1024) break
			}
			await lowPromise
			assertEquals(maxBuffered > 0, true)
		}
		finally {
			try { sender.close() } catch {}
			try { await left.close() } catch {}
			try { await right.close() } catch {}
		}
	},
})
