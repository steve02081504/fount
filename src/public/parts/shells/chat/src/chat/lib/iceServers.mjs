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
 * @returns {{ urls: string, username?: string, credential?: string } | null} 合法条目或 null
 */
function normalizeIceEntry(raw) {
	if (!raw || typeof raw !== 'object') return null
	const urlsRaw = raw.urls
	const urlsList = Array.isArray(urlsRaw)
		? urlsRaw.map(u => String(u).trim()).filter(Boolean)
		: [String(urlsRaw || '').trim()].filter(Boolean)
	if (!urlsList.length) return null
	for (const u of urlsList)
		if (!ICE_URL_RE.test(u)) return null
	const username = raw.username != null ? String(raw.username) : undefined
	const credential = raw.credential != null ? String(raw.credential) : undefined
	if ((username && !credential) || (!username && credential)) return null
	return {
		urls: urlsList.length === 1 ? urlsList[0] : urlsList,
		...username ? { username, credential } : {},
	}
}

/**
 * @param {unknown} groupSettings 物化群设置
 * @returns {{ urls: string, username?: string, credential?: string }[]} 合法 ICE 列表
 */
export function resolveIceServers(groupSettings) {
	const fromSettings = groupSettings?.iceServers || []
	const out = []
	for (const raw of fromSettings) {
		const entry = normalizeIceEntry(raw)
		if (entry) out.push(entry)
		if (out.length >= MAX_ICE_SERVERS) break
	}
	return out.length ? out : [...DEFAULT_ICE_SERVERS]
}

/**
 * 校验并规范化待写入 DAG 的 iceServers 数组。
 * @param {unknown} raw 请求体字段
 * @returns {{ urls: string, username?: string, credential?: string }[]} 校验后的 ICE 列表
 */
export function sanitizeIceServersForSettings(raw) {
	if (!raw?.length) return [...DEFAULT_ICE_SERVERS]
	const out = []
	for (const item of raw) {
		const entry = normalizeIceEntry(item)
		if (entry) out.push(entry)
		if (out.length >= MAX_ICE_SERVERS) break
	}
	return out.length ? out : [...DEFAULT_ICE_SERVERS]
}
