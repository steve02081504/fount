import { sanitizeIceServersForSettings } from 'npm:@steve02081504/fount-p2p/transport/ice_servers'

/**
 * 规范化 config.json 里的节点级 ICE/TURN 配置：校验、12 条上限与空列表回退默认 STUN 都归包的
 * sanitizer，这里只先按包真正读取的字段（urls 列表、username、credential）去重，免得等价写法
 * （字符串与单元素数组、字段顺序、多余字段）重复占掉那 12 条上限。
 * @param {unknown} raw config.json 中的 p2p.iceServers
 * @returns {{ urls: string | string[], username?: string, credential?: string }[]} 交给 link registry 的 ICE 列表
 */
export function normalizeNodeIceServers(raw) {
	const unique = new Map()
	for (const item of Array.isArray(raw) ? raw : []) {
		const urls = [item?.urls].flat().map(url => String(url || '')).filter(Boolean)
		const key = JSON.stringify([urls, item?.username || null, item?.credential || null])
		if (!unique.has(key)) unique.set(key, item)
	}
	return sanitizeIceServersForSettings([...unique.values()])
}
