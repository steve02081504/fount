/**
 * 单进程 werift DataChannel loopback 烟测。
 */
import { RTCPeerConnection } from 'npm:werift'

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const pc1 = new RTCPeerConnection(config)
const pc2 = new RTCPeerConnection(config)

pc1.onIceCandidate.subscribe(c => { if (c) void pc2.addIceCandidate(c) })
pc2.onIceCandidate.subscribe(c => { if (c) void pc1.addIceCandidate(c) })

const dc1 = pc1.createDataChannel('test')
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('timeout')), 30_000)
	pc2.onDataChannel.subscribe(ch => {
		clearTimeout(timer)
		console.warn('webrtc-smoke: data channel open', ch.label)
		resolve(undefined)
	})
	void (async () => {
		const offer = await pc1.createOffer()
		await pc1.setLocalDescription(offer)
		await pc2.setRemoteDescription(offer)
		const answer = await pc2.createAnswer()
		await pc2.setLocalDescription(answer)
		await pc1.setRemoteDescription(answer)
	})()
})
