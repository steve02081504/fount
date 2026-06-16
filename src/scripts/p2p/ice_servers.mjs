/**
 * 群级 ICE/TURN 配置解析（groupSettings.iceServers → RTCPeerConnection / Trystero）。
 */

const ICE_URL_RE = /^(stun|turn|turns):/iu
const MAX_ICE_SERVERS = 8

/** @type {{ urls: string, username?: string, credential?: string }[]} */
export const DEFAULT_ICE_SERVERS = [
	{ urls: 'stun:stun.l.google.com:19302' },
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
	const fromSettings = Array.isArray(groupSettings?.iceServers) ? groupSettings.iceServers : []
	const out = []
	for (const raw of fromSettings) {
		const entry = normalizeIceEntry(raw)
		if (entry) out.push(entry)
		if (out.length >= MAX_ICE_SERVERS) break
	}
	return out.length ? out : [...DEFAULT_ICE_SERVERS]
}

/**
 * @param {unknown} groupSettings 物化群设置
 * @returns {{ iceServers: ReturnType<typeof resolveIceServers> }} Trystero rtcConfig 片段
 */
export function resolveIceServersForTrystero(groupSettings) {
	return { iceServers: resolveIceServers(groupSettings) }
}

/**
 * 校验并规范化待写入 DAG 的 iceServers 数组。
 * @param {unknown} raw 请求体字段
 * @returns {{ urls: string, username?: string, credential?: string }[]} 校验后的 ICE 列表
 */
export function sanitizeIceServersForSettings(raw) {
	if (!Array.isArray(raw)) return [...DEFAULT_ICE_SERVERS]
	const out = []
	for (const item of raw) {
		const entry = normalizeIceEntry(item)
		if (entry) out.push(entry)
		if (out.length >= MAX_ICE_SERVERS) break
	}
	return out.length ? out : [...DEFAULT_ICE_SERVERS]
}
