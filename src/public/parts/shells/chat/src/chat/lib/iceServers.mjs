/**
 * 群级 ICE/TURN 配置解析（groupSettings.iceServers → 频道流媒体 WebRTC）。
 * 与 fount-network 建链无关；建链 ICE 由 link_registry 内部处理。
 */

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
 * @param {unknown} groupSettings 物化群设置
 * @returns {{ urls: string, username?: string, credential?: string }[]} 群级 ICE 列表
 */
export function resolveIceServers(groupSettings) {
	const iceServers = groupSettings?.iceServers
	return iceServers && iceServers.length ? iceServers : [...DEFAULT_ICE_SERVERS]
}

/**
 * 待写入 DAG 的 iceServers 数组。
 * @param {unknown} raw 请求体字段
 * @returns {{ urls: string, username?: string, credential?: string }[]} ICE 列表
 */
export function sanitizeIceServersForSettings(raw) {
	return raw && raw.length ? raw : [...DEFAULT_ICE_SERVERS]
}
