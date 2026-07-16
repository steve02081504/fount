/**
 * RTP 解包：Opus 直通；H264 RFC 6184 → Annex B access unit。
 */
/* eslint-disable jsdoc/require-returns-description */
import { Buffer } from 'node:buffer'

const NAL_TYPE_SPS = 7
const NAL_TYPE_PPS = 8
const NAL_TYPE_IDR = 5

/**
 * @param {Buffer} packet RTP 包
 * @returns {{ payloadType: number, marker: boolean, timestamp: number, payload: Buffer } | null}
 */
export function parseRtpHeader(packet) {
	if (!Buffer.isBuffer(packet) || packet.length < 12) return null
	const payloadType = packet[1] & 0x7f
	const marker = !!(packet[1] & 0x80)
	const timestamp = packet.readUInt32BE(4)
	const csrcCount = packet[0] & 0x0f
	let headerLen = 12 + csrcCount * 4
	const x = !!(packet[0] & 0x10)
	if (x) {
		if (packet.length < headerLen + 4) return null
		const extLen = packet.readUInt16BE(headerLen + 2)
		headerLen += 4 + extLen * 4
	}
	if (packet.length <= headerLen) return null
	return {
		payloadType,
		marker,
		timestamp,
		payload: packet.subarray(headerLen),
	}
}

/**
 * @param {Buffer} nalu 含起始码或裸 NAL
 * @returns {Buffer} Annex B
 */
function toAnnexB(nalu) {
	if (nalu.length >= 4 && nalu[0] === 0 && nalu[1] === 0 && nalu[2] === 0 && nalu[3] === 1)
		return nalu
	return Buffer.concat([Buffer.from([0, 0, 0, 1]), nalu])
}

/**
 * H264 RTP 重组器。
 * @returns {{ feed: (packet: Buffer) => { annexB: Buffer, key: boolean, sps?: Buffer, pps?: Buffer, width?: number, height?: number } | null, reset: () => void }}
 */
export function createH264Depacketizer() {
	/** @type {Buffer[]} */
	let fuParts = []
	let fuTs = 0
	/** @type {Buffer | null} */
	let sps = null
	/** @type {Buffer | null} */
	let pps = null

	/**
	 * @param {Buffer} spsNal SPS NAL
	 * @returns {{ width?: number, height?: number }}
	 */
	const parseSpsDims = spsNal => {
		if (spsNal.length < 4) return {}
		// 简化：常见 1080p/720p 缺省；完整 SPS 解析过重，WHIP ingest 可从 SDP 或首 IDR 前 SPS 更新
		return {}
	}

	return {
		/** @returns {void} */
		reset() {
			fuParts = []
			fuTs = 0
		},
		/**
		 * @param {Buffer} packet RTP
		 * @returns {{ annexB: Buffer, key: boolean, sps?: Buffer, pps?: Buffer, width?: number, height?: number } | null}
		 */
		feed(packet) {
			const hdr = parseRtpHeader(packet)
			if (!hdr || !hdr.payload.length) return null
			const nalHeader = hdr.payload[0]
			const nalType = nalHeader & 0x1f

			if (nalType >= 1 && nalType <= 23) {
				const nalu = hdr.payload
				if (nalType === NAL_TYPE_SPS) {
					sps = Buffer.from(nalu)
					parseSpsDims(sps)
					return null
				}
				if (nalType === NAL_TYPE_PPS) {
					pps = Buffer.from(nalu)
					return null
				}
				const key = nalType === NAL_TYPE_IDR
				const parts = []
				if (key && sps) parts.push(toAnnexB(sps))
				if (key && pps) parts.push(toAnnexB(pps))
				parts.push(toAnnexB(nalu))
				return {
					annexB: Buffer.concat(parts),
					key,
					sps: sps || undefined,
					pps: pps || undefined,
				}
			}

			if (nalType === 24) {
				let off = 1
				const nals = []
				while (off + 2 <= hdr.payload.length) {
					const sz = hdr.payload.readUInt16BE(off)
					off += 2
					if (off + sz > hdr.payload.length) break
					nals.push(hdr.payload.subarray(off, off + sz))
					off += sz
				}
				if (!nals.length) return null
				const key = nals.some(n => (n[0] & 0x1f) === NAL_TYPE_IDR)
				const parts = []
				for (const n of nals) {
					const t = n[0] & 0x1f
					if (t === NAL_TYPE_SPS) sps = Buffer.from(n)
					if (t === NAL_TYPE_PPS) pps = Buffer.from(n)
				}
				if (key && sps) parts.push(toAnnexB(sps))
				if (key && pps) parts.push(toAnnexB(pps))
				for (const n of nals) parts.push(toAnnexB(n))
				return { annexB: Buffer.concat(parts), key, sps: sps || undefined, pps: pps || undefined }
			}

			if (nalType === 28) {
				const fuHeader = hdr.payload[1]
				const start = !!(fuHeader & 0x80)
				const end = !!(fuHeader & 0x40)
				const reconstructedType = (nalHeader & 0xe0) | (fuHeader & 0x1f)
				const chunk = hdr.payload.subarray(2)
				if (start) {
					fuParts = [Buffer.from([reconstructedType]), chunk]
					fuTs = hdr.timestamp
				}
				else if (fuParts.length) 
					fuParts.push(chunk)
				
				if (!end || !fuParts.length) return null
				const nalu = Buffer.concat(fuParts)
				fuParts = []
				const type = nalu[0] & 0x1f
				const key = type === NAL_TYPE_IDR
				const parts = []
				if (key && sps) parts.push(toAnnexB(sps))
				if (key && pps) parts.push(toAnnexB(pps))
				parts.push(toAnnexB(nalu))
				return { annexB: Buffer.concat(parts), key, sps: sps || undefined, pps: pps || undefined }
			}

			return null
		},
	}
}

/**
 * Opus RTP → 载荷即帧。
 * @param {Buffer} packet RTP
 * @returns {Buffer | null} Opus 帧
 */
export function depacketizeOpus(packet) {
	const hdr = parseRtpHeader(packet)
	if (!hdr || !hdr.payload.length) return null
	return hdr.payload
}
