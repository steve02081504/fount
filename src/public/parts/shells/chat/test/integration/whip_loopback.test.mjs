/**
 * WHIP 冒烟：node-datachannel 双端 loopback 媒体轨。
 */
/* global Deno */
import nodeDataChannel from 'npm:node-datachannel'

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { parseOfferMedia } from '../../src/chat/whip/sdp.mjs'

const { PeerConnection, Video, Audio, RtcpReceivingSession } = nodeDataChannel

Deno.test({
	name: 'whip loopback: offer parse + peer connection states',
	sanitizeResources: false,
	sanitizeOps: false,
}, async () => {
	const offerLines = [
		'v=0',
		'o=- 0 0 IN IP4 127.0.0.1',
		's=-',
		't=0 0',
		'a=ice-ufrag:abcd',
		'a=ice-pwd:efghijklmnopqrstuvwxyz012345',
		'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
		'm=video 9 UDP/TLS/RTP/SAVPF 96',
		'a=rtpmap:96 H264/90000',
		'a=mid:video',
		'm=audio 9 UDP/TLS/RTP/SAVPF 111',
		'a=rtpmap:111 opus/48000/2',
		'a=mid:audio',
	]
	const offerSdp = offerLines.join('\r\n') + '\r\n'
	const info = parseOfferMedia(offerSdp)
	assert(info.h264Pt === 96)
	assert(info.opusPt === 111)

	const server = new PeerConnection('whip-server', {
		iceServers: [],
		disableAutoNegotiation: true,
		forceMediaTransport: true,
		portRangeBegin: 50000,
		portRangeEnd: 50100,
	})
	const rtcp = new RtcpReceivingSession()
	const video = new Video('video', 'RecvOnly')
	video.addH264Codec(96)
	const vTrack = server.addTrack(video)
	vTrack.setMediaHandler(rtcp)

	const answerPromise = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('answer timeout')), 8000)
		server.onLocalDescription((sdp, type) => {
			if (String(type).toLowerCase() === 'answer') {
				clearTimeout(timer)
				resolve(sdp)
			}
		})
	})

	server.setRemoteDescription(offerSdp, 'offer')
	server.setLocalDescription('answer')
	const answer = await answerPromise
	assert(answer.includes('v=0'))

	server.close()
})
