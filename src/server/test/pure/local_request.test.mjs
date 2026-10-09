/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { is_direct_local_request, is_trusted_direct_local_request } from '../../../scripts/local_request.mjs'

/**
 * 测试用回环地址集合。
 * @param {string} ip 地址。
 * @returns {boolean} 是否回环。
 */
const isLocalIP = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
/**
 * 模拟 HTTP / WebSocket 请求。
 * @param {object} headers 请求头。
 * @param {string} ip 解析后的地址。
 * @param {string} socketIP 连接地址。
 * @returns {object} 请求。
 */
const request = (headers = {}, ip = '127.0.0.1', socketIP = ip) => ({
	headers: { host: 'localhost:8931', ...headers }, ip, socket: { remoteAddress: socketIP },
})

Deno.test('direct local HTTP and WebSocket requests require local transport and authority', () => {
	for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
		for (const host of ['localhost:8931', '127.0.0.1:8931', '[::1]:8931'])
			assertEquals(is_trusted_direct_local_request(request({ host }, ip), isLocalIP), true)
	for (const host of ['fount.example', 'localhost.attacker.example', '', undefined, 'localhost,example.com', 'localhost@evil.example'])
		assertEquals(is_direct_local_request(request({ host }), isLocalIP), false)
	assertEquals(is_direct_local_request(request({}, '127.0.0.1', '203.0.113.9'), isLocalIP), false)
	assertEquals(is_direct_local_request(request({}, '203.0.113.9', '127.0.0.1'), isLocalIP), false)
	assertEquals(is_direct_local_request({ headers: { host: 'localhost' } }, isLocalIP), false)
})

Deno.test('tunnels, proxies and cross-site origins stay remote even when they claim localhost', () => {
	for (const header of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'via', 'x-real-ip', 'cf-connecting-ip', 'cf-connecting-ipv6', 'cf-ray', 'true-client-ip'])
		for (const value of ['127.0.0.1', '', '203.0.113.9']) {
			const req = request({ [header]: value })
			assertEquals(is_direct_local_request(req, isLocalIP), false, header)
			assertEquals(is_trusted_direct_local_request(req, isLocalIP), false, header)
		}
})

Deno.test('cross-site browser requests cannot acquire trusted local privileges', () => {
	for (const origin of ['https://evil.example', 'null', 'malformed'])
		assertEquals(is_trusted_direct_local_request(request({ origin }), isLocalIP), false)
	assertEquals(is_trusted_direct_local_request(request({ origin: 'http://localhost:8931' }), isLocalIP), true)
	// 官方 Pages 的 P2P 探测按直接本机来源判定，Origin 另有独立白名单。
	assertEquals(is_direct_local_request(request({ origin: 'https://steve02081504.github.io' }), isLocalIP), true)
})
