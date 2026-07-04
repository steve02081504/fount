import process from 'node:process'
import { Buffer } from 'node:buffer'

import { wrapRtcPeerConnectionForMdns } from '../rtc_mdns_filter.mjs'
import { getSignalingRuntimeConfig } from '../node/instance.mjs'

if (!globalThis.Buffer) globalThis.Buffer = Buffer
if (!globalThis.process) globalThis.process = process

/** @type {Promise<{ RTCPeerConnection: typeof RTCPeerConnection, RTCIceCandidate: typeof RTCIceCandidate }> | null} */
let rtcPromise = null

/**
 * @returns {Promise<{ RTCPeerConnection: typeof RTCPeerConnection, RTCIceCandidate: typeof RTCIceCandidate }>}
 */
export async function loadNodeRtcPolyfill() {
	if (rtcPromise) return await rtcPromise
	rtcPromise = (async () => {
		const mod = await import('npm:node-datachannel/polyfill')
		const { mdnsPolicy } = getSignalingRuntimeConfig()
		return {
			RTCPeerConnection: wrapRtcPeerConnectionForMdns(mod.RTCPeerConnection, mod.RTCIceCandidate, mdnsPolicy),
			RTCIceCandidate: mod.RTCIceCandidate,
		}
	})()
	return await rtcPromise
}

/**
 * @param {RTCPeerConnection} pc
 * @param {(event: { candidate: RTCIceCandidate | null }) => void} handler
 * @returns {void}
 */
export function attachIceCandidateListener(pc, handler) {
	pc.onicecandidate = handler
	if (pc.onIceCandidate?.subscribe)
		pc.onIceCandidate.subscribe(candidate => handler({ candidate: candidate ?? null }))
}

/**
 * @param {RTCPeerConnection} pc
 * @param {(event: { channel: RTCDataChannel }) => void} handler
 * @returns {void}
 */
export function attachDataChannelListener(pc, handler) {
	pc.ondatachannel = handler
	if (pc.onDataChannel?.subscribe)
		pc.onDataChannel.subscribe(channel => handler({ channel }))
}

/**
 * @param {RTCDataChannel} channel
 * @param {'open' | 'close'} eventName
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
export function waitForChannelState(channel, eventName, timeoutMs) {
	return new Promise((resolve, reject) => {
		if (eventName === 'open' && channel.readyState === 'open') {
			resolve()
			return
		}
		if (eventName === 'close' && channel.readyState === 'closed') {
			resolve()
			return
		}
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error(`p2p: data channel ${eventName} timeout after ${timeoutMs}ms`))
		}, timeoutMs)
		const handler = () => {
			cleanup()
			resolve()
		}
		const cleanup = () => {
			clearTimeout(timer)
			channel.removeEventListener?.(eventName, handler)
			if (eventName === 'open' && channel.onopen === handler) channel.onopen = null
			if (eventName === 'close' && channel.onclose === handler) channel.onclose = null
		}
		channel.addEventListener?.(eventName, handler)
		if (eventName === 'open') channel.onopen = handler
		if (eventName === 'close') channel.onclose = handler
	})
}

/**
 * @param {unknown} data
 * @returns {Uint8Array}
 */
export function signalDataToBytes(data) {
	if (data instanceof Uint8Array) return data
	if (data instanceof ArrayBuffer) return new Uint8Array(data)
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
	if (typeof data === 'string') return new TextEncoder().encode(data)
	return new TextEncoder().encode(String(data ?? ''))
}
