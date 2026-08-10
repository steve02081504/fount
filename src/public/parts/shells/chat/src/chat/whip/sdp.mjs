/**
 * WHIP SDP：解析 offer 媒体行，生成 answer。
 * node-datachannel 仅在 acceptWhipOffer 时懒加载——静态 import 会在 Termux 等无 native prebuild 的平台上拖垮整个 chat shell。
 */

/**
 * WHIP offer 媒体信息摘要。
 * @typedef {object} WhipMediaInfo
 * @property {number | null} h264Pt H264 payload type
 * @property {number | null} opusPt Opus payload type
 * @property {string | null} videoMid 视频 m-line mid
 * @property {string | null} audioMid 音频 m-line mid
 */

/**
 * 解析 WHIP offer SDP，提取 H264/Opus payload type 与 mid。
 * @param {string} sdp SDP 文本
 * @returns {WhipMediaInfo} H264/Opus payload type 与 mid
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
 * 加载 node-datachannel 默认导出。
 * @returns {Promise<import('npm:node-datachannel').default>} 原生绑定
 */
async function loadNodeDataChannel() {
	try {
		const mod = await import('npm:node-datachannel')
		return mod.default ?? mod
	}
	catch (error) {
		const err = new Error('WHIP ingest requires node-datachannel native addon', { cause: error })
		err.code = 'WHIP_NATIVE_UNAVAILABLE'
		err.skip_report = true
		throw err
	}
}

/**
 * 接受 WHIP offer，创建仅接收方向的 PeerConnection 并生成 answer SDP。
 * @param {string} offerSdp WHIP offer SDP（如 OBS 推流）
 * @param {object} handlers 轨道回调
 * @param {(track: import('npm:node-datachannel').Track, kind: 'video' | 'audio', info: WhipMediaInfo, rtp: Buffer) => void} handlers.onTrack 每收到 RTP 包时调用
 * @returns {Promise<{ answerSdp: string, pc: import('npm:node-datachannel').PeerConnection, info: WhipMediaInfo, close: () => void }>} answer SDP 与 PeerConnection 句柄
 */
export async function acceptWhipOffer(offerSdp, handlers) {
	const { PeerConnection, Video, Audio, RtcpReceivingSession } = await loadNodeDataChannel()
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
		/** 关闭 WHIP PeerConnection 与轨道。 */
		close: () => {
			for (const t of tracks) try { t.close() } catch { /* ignore */ }
			try { pc.close() } catch { /* ignore */ }
		},
	}
}
