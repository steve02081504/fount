/**
 * RTP H264/Opus 解包单测。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createH264Depacketizer, depacketizeOpus, parseRtpHeader } from '../../src/chat/whip/rtp.mjs'

/**
 * @param {number} pt payload type
 * @param {Buffer} payload 载荷
 * @param {boolean} [marker=false] M 位
 * @returns {Buffer} 含 12 字节 RTP 头的完整包
 */
function buildRtp(pt, payload, marker = false) {
	const buf = Buffer.alloc(12 + payload.length)
	buf[0] = 0x80
	buf[1] = (marker ? 0x80 : 0) | (pt & 0x7f)
	buf.writeUInt32BE(90000, 4)
	payload.copy(buf, 12)
	return buf
}

Deno.test('depacketizeOpus returns payload bytes', () => {
	const payload = Buffer.from([0x01, 0x02, 0x03])
	const pkt = buildRtp(111, payload)
	assertEquals(depacketizeOpus(pkt)?.toString('hex'), payload.toString('hex'))
})

Deno.test('h264 single NAL IDR yields annexB keyframe', () => {
	const dep = createH264Depacketizer()
	const sps = Buffer.from([0x67, 0x42, 0x00, 0x1f])
	const pps = Buffer.from([0x68, 0xce, 0x38, 0x80])
	dep.feed(buildRtp(96, sps))
	dep.feed(buildRtp(96, pps))
	const idr = Buffer.from([0x65, 0x88, 0x84, 0x00])
	const au = dep.feed(buildRtp(96, idr, true))
	assert(au)
	assertEquals(au.key, true)
	assert(au.annexB.subarray(0, 4).toString('hex'), '00000001')
})

Deno.test('parseRtpHeader rejects short buffer', () => {
	assertEquals(parseRtpHeader(Buffer.alloc(8)), null)
})
