/**
 * 群级 ICE/TURN 配置解析（groupSettings.iceServers → 频道流媒体 WebRTC）。
 * 与 fount-network 建链无关；建链 ICE 由 link_registry 内部处理。
 */

const ICE_URL_RE = /^(stun|turn|turns):/iu
const MAX_ICE_SERVERS = 12

/** @type {{ urls: string, username?: string, credential?: string }[]} */
export const DEFAULT_ICE_SERVERS = [
	// Global first — ICE tries in order; regional CN servers are fallback when global STUN is blocked.
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun.cloudflare.com:3478' },
	{ urls: 'stun:global.stun.twilio.com:3478' },
	{ urls: 'stun:stun.nextcloud.com:3478' },
	{ urls: 'stun:stun.voip.blackberry.com:3478' },
	{ urls: 'stun:stun.freeswitch.org:3478' },
	{ urls: 'stun:stun.chat.bilibili.com:3478' },
	{ urls: 'stun:stun.hitv.com:3478' },
	{ urls: 'stun:stun.miwifi.com:3478' },
]

/**
 * @param {unknown} raw 单条 ICE 配置
 * @returns {{ urls: string | string[], username?: string, credential?: string } | null} 合法条目或 null
 */
function normalizeIceEntry(raw) {
	if (!raw) return null
	const urls = [raw.urls].flat().filter(Boolean)
	if (!urls.length || urls.some(url => !ICE_URL_RE.test(url))) return null
	const username = raw.username != null ? String(raw.username) : undefined
	const credential = raw.credential != null ? String(raw.credential) : undefined
	if (!!username !== !!credential) return null
	return {
		urls: urls.length === 1 ? urls[0] : urls,
		...username ? { username, credential } : {},
	}
}

/**
 * @param {unknown[]} list 待清洗条目
 * @returns {{ urls: string | string[], username?: string, credential?: string }[]} 合法 ICE 列表
 */
function normalizeIceServers(list) {
	const out = []
	for (const raw of list) {
		const entry = normalizeIceEntry(raw)
		if (entry) out.push(entry)
		if (out.length >= MAX_ICE_SERVERS) break
	}
	return out.length ? out : [...DEFAULT_ICE_SERVERS]
}

/**
 * @param {unknown} groupSettings 物化群设置
 * @returns {{ urls: string | string[], username?: string, credential?: string }[]} 合法 ICE 列表
 */
export function resolveIceServers(groupSettings) {
	return normalizeIceServers(groupSettings?.iceServers || [])
}

/**
 * 校验并规范化待写入 DAG 的 iceServers 数组。
 * @param {unknown} raw 请求体字段
 * @returns {{ urls: string, username?: string, credential?: string }[]} 校验后的 ICE 列表
 */
export function sanitizeIceServersForSettings(raw) {
	return normalizeIceServers(raw?.length ? raw : [])
}
