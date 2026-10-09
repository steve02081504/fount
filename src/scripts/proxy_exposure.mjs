import dns from 'node:dns/promises'
import net from 'node:net'
import os from 'node:os'

import { with_timeout } from './await_timeout.mjs'
import { hasForwardingHeaders, parseRequestHost } from './local_request.mjs'

/** 公网代理配置说明页；不附带节点 URL、令牌或其他请求数据。 */
export const PROXY_EXPOSURE_PAGE = 'https://steve02081504.github.io/fount/proxy-exposure/'

/** 公网域名解析等待上限；解析不出来就不凭空推断公网接入。 */
const LOOKUP_TIMEOUT = 3000
/** 域名判定缓存条数与存活时间，避免每个请求都重新解析 Host。 */
const CACHE_LIMIT = 256
const CACHE_TTL = 60_000

/**
 * 解析 IPv4-mapped IPv6（`::ffff:a.b.c.d`、`::ffff:aabb:ccdd`）为点分 IPv4；其余地址原样返回。
 * @param {string} address IP。
 * @returns {string} 小写点分 IPv4 或原地址。
 */
function toIPv4(address) {
	const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
	if (dotted) return dotted
	const hex = address.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/u)
	if (!hex) return address
	const [high, low] = [hex[1], hex[2]].map(value => parseInt(value, 16))
	return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

/**
 * @param {string} address IP。
 * @returns {boolean} 本机或局域网地址。
 */
export function isLocalAddress(address) {
	address = toIPv4(address.toLowerCase())
	if (Object.values(os.networkInterfaces()).flat().some(item => item?.address.toLowerCase() === address)) return true
	if (net.isIP(address) === 4) {
		const [a, b] = address.split('.').map(Number)
		return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
	}
	return address === '::' || address === '::1' || /^(?:f[cd]|fe[89ab])/u.test(address)
}

/**
 * 缓存 DNS 判定；解析失败或超时不凭空推断公网接入。
 * @param {Function} lookup DNS 查询，可注入测试实现。
 * @returns {Function} 请求是否缺少公网代理转发标记。
 */
export function createExposureDetector(lookup = hostname => dns.lookup(hostname, { all: true })) {
	const cache = new Map()
	return async req => {
		if (hasForwardingHeaders(req.headers)) return false
		// IPv6 的 hostname 带方括号，IP 判定前必须去掉。
		const hostname = parseRequestHost(req.headers?.host).replace(/^\[|\]$/gu, '')
		if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false
		if (net.isIP(hostname)) return !isLocalAddress(hostname)
		const cached = cache.get(hostname)
		if (cached?.expiry > Date.now()) return cached.result
		const result = with_timeout(LOOKUP_TIMEOUT, lookup(hostname))
			.then(addresses => addresses.some(({ address }) => net.isIP(address) && !isLocalAddress(address)))
			.catch(() => false)
		if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
		cache.set(hostname, { expiry: Date.now() + CACHE_TTL, result })
		return result
	}
}

/**
 * @param {object} req 请求。
 * @param {object} res 响应。
 * @returns {void} 提示服务器响应。
 */
export function exposureResponse(req, res) {
	res.setHeader('Cache-Control', 'no-store')
	res.setHeader('Connection', 'close')
	const html = String(req.headers?.accept ?? '').split(',').some(value => {
		const [type, ...params] = value.trim().toLowerCase().split(';')
		return type.trim() === 'text/html' && !params.some(param => /^\s*q\s*=\s*0(?:\.0*)?\s*$/u.test(param))
	})
	res.statusCode = html ? 303 : 500
	if (html) res.setHeader('Location', PROXY_EXPOSURE_PAGE)
	res.end()
}
