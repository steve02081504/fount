import { getNodeTransportSettings } from '../node/identity.mjs'

import mailboxTunables from './mailbox.tunables.json' with { type: 'json' }

/**
 * @param {object} raw 节点 mailbox 配置片段
 * @returns {{ maxHop: number, relayFanoutTrusted: number, relayFanoutNormal: number, wantFanout: number }} 规范化 mailbox 配置
 */
export function normalizeMailboxSettings(raw = {}) {
	const maxHop = Math.max(1, Math.min(8, Number(raw.maxHop) || mailboxTunables.maxHop))
	const relayFanoutTrusted = Math.max(1, Math.min(32, Number(raw.relayFanoutTrusted) || mailboxTunables.relayFanoutTrusted))
	const relayFanoutNormal = Math.max(1, Math.min(32, Number(raw.relayFanoutNormal) || mailboxTunables.relayFanoutNormal))
	const wantFanout = Math.max(1, Math.min(32, Number(raw.wantFanout) || mailboxTunables.wantFanout))
	return { maxHop, relayFanoutTrusted, relayFanoutNormal, wantFanout }
}

/**
 * @returns {{ maxHop: number, relayFanoutTrusted: number, relayFanoutNormal: number, wantFanout: number, batterySaver: boolean }} mailbox 路由配置
 */
export function getMailboxRoutingSettings() {
	const { batterySaver, mailbox } = getNodeTransportSettings()
	const base = normalizeMailboxSettings(mailbox)
	if (!batterySaver) return { ...base, batterySaver: false }
	return {
		maxHop: base.maxHop,
		relayFanoutTrusted: Math.max(1, Math.ceil(base.relayFanoutTrusted / 2)),
		relayFanoutNormal: Math.max(1, Math.ceil(base.relayFanoutNormal / 2)),
		wantFanout: Math.max(1, Math.ceil(base.wantFanout / 2)),
		batterySaver: true,
	}
}
