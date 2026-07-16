/**
 * WHIP ingest 会话：RTP → av-relay 二进制帧。
 */
/* eslint-disable jsdoc/require-returns-description, jsdoc/require-param-description */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import {
	AV_FRAME_AUDIO,
	AV_FRAME_VIDEO,
	AV_RELAY_HEADER_SIZE,
	injectAvRelayFrame,
	injectAvRelayControl,
} from '../ws/avRelay.mjs'

import { createH264Depacketizer, depacketizeOpus } from './rtp.mjs'
import { acceptWhipOffer } from './sdp.mjs'

/** @type {Map<string, { close: () => void }>} */
const sessionsByRoom = new Map()

/**
 * @param {Uint8Array} senderId 16 字节
 * @param {number} frameType 0/1
 * @param {boolean} isKey keyframe
 * @param {Buffer} data 载荷
 * @param {number} t0 起点 ms
 * @param {{ seq: number }} seqRef 序号
 * @returns {Buffer}
 */
function packFrame(senderId, frameType, isKey, data, t0, seqRef) {
	const out = Buffer.alloc(AV_RELAY_HEADER_SIZE + data.length)
	out[0] = frameType
	out[1] = isKey ? 1 : 0
	out.writeUInt32BE(seqRef.seq++, 2)
	out.writeUInt32BE((Date.now() - t0) | 0, 6)
	Buffer.from(senderId).copy(out, 10)
	data.copy(out, AV_RELAY_HEADER_SIZE)
	return out
}

/**
 * @param {string} roomId av-relay 房间
 * @param {string} offerSdp WHIP offer
 * @param {object} [opts]
 * @param {(meta: object) => void} [opts.onPublishMeta]
 * @returns {Promise<{ answerSdp: string, sessionId: string, close: () => void }>}
 */
export async function startWhipIngest(roomId, offerSdp, opts = {}) {
	const existing = sessionsByRoom.get(roomId)
	existing?.close()

	const senderId = randomBytes(16)
	const senderHex = Buffer.from(senderId).toString('hex')
	const t0 = Date.now()
	const videoSeq = { seq: 0 }
	const audioSeq = { seq: 0 }
	const h264 = createH264Depacketizer()
	let publishedVideoMeta = false
	let publishedAudioMeta = false

	const whip = await acceptWhipOffer(offerSdp, {
		/**
		 * @param {import('npm:node-datachannel').Track} _track
		 * @param {'video' | 'audio'} kind
		 * @param {import('./sdp.mjs').WhipMediaInfo} info
		 * @param {Buffer} rtp
		 * @returns {void}
		 */
		onTrack(_track, kind, info, rtp) {
			if (kind === 'audio' && info.opusPt != null) {
				const opus = depacketizeOpus(rtp)
				if (!opus?.length) return
				if (!publishedAudioMeta) {
					publishedAudioMeta = true
					injectAvRelayControl(roomId, {
						type: 'publish_meta',
						senderId: senderHex,
						video: null,
						audio: { codec: 'opus' },
					})
				}
				const buf = packFrame(senderId, AV_FRAME_AUDIO, true, opus, t0, audioSeq)
				injectAvRelayFrame(roomId, buf)
				return
			}
			if (kind === 'video') {
				const au = h264.feed(rtp)
				if (!au) return
				if (!publishedVideoMeta && opts.onPublishMeta) {
					publishedVideoMeta = true
					injectAvRelayControl(roomId, {
						type: 'publish_meta',
						senderId: senderHex,
						video: { codec: 'avc', w: 1280, h: 720 },
						audio: info.opusPt != null ? { codec: 'opus' } : null,
					})
				}
				const buf = packFrame(senderId, AV_FRAME_VIDEO, au.key, au.annexB, t0, videoSeq)
				injectAvRelayFrame(roomId, buf)
			}
		},
	})

	const sessionId = senderHex
	/**
	 *
	 */
	const close = () => {
		whip.close()
		sessionsByRoom.delete(roomId)
		if (opts.onPublishMeta)
			injectAvRelayControl(roomId, { type: 'publish_meta_revoke', senderId: senderHex })
	}
	sessionsByRoom.set(roomId, { close })
	return { answerSdp: whip.answerSdp, sessionId, close }
}

/**
 * @param {string} roomId 房间
 * @returns {void}
 */
export function stopWhipIngest(roomId) {
	sessionsByRoom.get(roomId)?.close()
}
