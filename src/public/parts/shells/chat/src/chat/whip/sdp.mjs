/**
 * WHIP SDP：解析 offer 媒体行，生成 answer。
 */
/* eslint-disable jsdoc/require-returns-description, jsdoc/require-param-description */
import nodeDataChannel from 'npm:node-datachannel'

const { PeerConnection, Video, Audio, RtcpReceivingSession } = nodeDataChannel

/**
 * @typedef {object} WhipMediaInfo
 * @property {number | null} h264Pt H264 payload type
 * @property {number | null} opusPt Opus payload type
 * @property {string | null} videoMid
 * @property {string | null} audioMid
 */

/**
 * @param {string} sdp SDP 文本
 * @returns {WhipMediaInfo}
 */
export function parseOfferMedia(sdp) {
	const info = {
		h264Pt: null,
		opusPt: null,
		videoMid: null,
		audioMid: null,
	}
	const lines = String(sdp || '').split(/\r?\n/)
	/** @type {string | null} */
	let curMid = null
	for (const line of lines) {
		const mid = line.match(/^a=mid:(\S+)/)
		if (mid) curMid = mid[1]
		const ptMatch = line.match(/^a=rtpmap:(\d+)\s+(\S+)/i)
		if (!ptMatch) continue
		const pt = Number(ptMatch[1])
		const codec = ptMatch[2].toLowerCase()
		if (codec.startsWith('h264')) {
			info.h264Pt = pt
			info.videoMid = curMid
		}
		if (codec.startsWith('opus')) {
			info.opusPt = pt
			info.audioMid = curMid
		}
	}
	return info
}

/**
 * @param {string} offerSdp WHIP offer SDP（如 OBS 推流）
 * @param {object} handlers 轨道回调
 * @param {(track: import('npm:node-datachannel').Track, kind: 'video' | 'audio', info: WhipMediaInfo) => void} handlers.onTrack
 * @returns {Promise<{ answerSdp: string, pc: import('npm:node-datachannel').PeerConnection, info: WhipMediaInfo, close: () => void }>}
 */
export async function acceptWhipOffer(offerSdp, handlers) {
	const info = parseOfferMedia(offerSdp)
	const pc = new PeerConnection('whip-ingest', {
		iceServers: ['stun:stun.l.google.com:19302'],
		disableAutoNegotiation: true,
		forceMediaTransport: true,
	})

	const rtcp = new RtcpReceivingSession()
	const tracks = []

	if (info.h264Pt != null) {
		const video = new Video(info.videoMid || 'video', 'RecvOnly')
		video.addH264Codec(info.h264Pt)
		const track = pc.addTrack(video)
		track.setMediaHandler(rtcp)
		track.onMessage(buf => handlers.onTrack(track, 'video', info, buf))
		tracks.push(track)
	}
	if (info.opusPt != null) {
		const audio = new Audio(info.audioMid || 'audio', 'RecvOnly')
		audio.addOpusCodec(info.opusPt)
		const track = pc.addTrack(audio)
		track.setMediaHandler(rtcp)
		track.onMessage(buf => handlers.onTrack(track, 'audio', info, buf))
		tracks.push(track)
	}

	const answerPromise = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('whip answer timeout')), 10_000)
		pc.onLocalDescription((sdp, type) => {
			if (String(type).toLowerCase() !== 'answer') return
			clearTimeout(timer)
			resolve(sdp)
		})
		pc.onStateChange(state => {
			if (state === 'failed') {
				clearTimeout(timer)
				reject(new Error('whip pc failed'))
			}
		})
	})

	pc.setRemoteDescription(offerSdp, 'offer')
	pc.setLocalDescription('answer')
	const answerSdp = await answerPromise

	return {
		answerSdp,
		pc,
		info,
		/** @returns {void} */
		close: () => {
			for (const t of tracks) try { t.close() } catch { /* ignore */ }
			try { pc.close() } catch { /* ignore */ }
		},
	}
}
