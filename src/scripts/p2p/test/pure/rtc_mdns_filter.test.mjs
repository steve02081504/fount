/**
 * mDNS ICE candidate 策略单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts'

import { applyMdnsHostCandidatePolicy, filterMdnsIceCandidate } from '../../rtc_mdns_filter.mjs'

Deno.test('applyMdnsHostCandidatePolicy rewrite-loopback rewrites .local host', () => {
	const sdp = 'candidate:1 1 udp 2130706431 abc123.local 54321 typ host generation 0'
	const out = applyMdnsHostCandidatePolicy(sdp, 'rewrite-loopback')
	assertEquals(out?.includes('127.0.0.1'), true)
	assertEquals(out?.includes('.local'), false)
})

Deno.test('applyMdnsHostCandidatePolicy drop discards .local host', () => {
	const sdp = 'candidate:1 1 udp 2130706431 abc123.local 54321 typ host generation 0'
	assertEquals(applyMdnsHostCandidatePolicy(sdp, 'drop'), null)
})

Deno.test('applyMdnsHostCandidatePolicy leaves srflx unchanged', () => {
	const sdp = 'candidate:2 1 udp 1694498815 203.0.113.1 54321 typ srflx raddr 0.0.0.0 rport 0 generation 0'
	assertEquals(applyMdnsHostCandidatePolicy(sdp, 'rewrite-loopback'), sdp)
})

Deno.test('filterMdnsIceCandidate rewrite-loopback rewrites mDNS host object', () => {
	const raw = { candidate: 'candidate:0 1 udp 2130706431 x.local 9 typ host', sdpMid: '0', sdpMLineIndex: 0 }
	const out = filterMdnsIceCandidate(raw, null, 'rewrite-loopback')
	assertEquals(out?.candidate?.includes('127.0.0.1'), true)
})

Deno.test('filterMdnsIceCandidate none passes through unchanged', () => {
	const raw = { candidate: 'candidate:0 1 udp 2130706431 x.local 9 typ host', sdpMid: '0', sdpMLineIndex: 0 }
	assertEquals(filterMdnsIceCandidate(raw, null, 'none'), raw)
})
