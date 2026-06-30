import { getNodeTransportSettings } from '../node/identity.mjs'
import {
	resolveMailboxRelayFanout,
	resolveMailboxWantFanout,
} from '../tunables_resolve.mjs'

import mailboxTunables from './mailbox.tunables.json' with { type: 'json' }

/**
 * @param {object} raw 节点 mailbox 配置片段
 * @param {number} [peerCount=0] 已知在线 relay 候选数（0 时用 floor）
 * @returns {{ maxHop: number, relayFanoutTrusted: number, relayFanoutNormal: number, wantFanout: number }} 规范化 mailbox 配置
 */
export function normalizeMailboxSettings(raw = {}, peerCount = 0) {
	const maxHop = Math.max(1, Math.min(8, Number(raw.maxHop) || mailboxTunables.maxHop))
	const capTrusted = mailboxTunables.relayFanoutTrustedCap ?? 32
	const capWant = mailboxTunables.wantFanoutCap ?? 32
	const n = Math.max(0, Math.floor(Number(peerCount) || 0))
	const relayFanoutTrusted = Number.isFinite(Number(raw.relayFanoutTrusted))
		? Math.max(1, Math.min(capTrusted, Math.floor(Number(raw.relayFanoutTrusted))))
		: resolveMailboxRelayFanout(n, mailboxTunables)
	const relayFanoutNormal = Math.max(1, Math.min(capTrusted, Number(raw.relayFanoutNormal) || mailboxTunables.relayFanoutNormal))
	const wantFanout = Number.isFinite(Number(raw.wantFanout))
		? Math.max(1, Math.min(capWant, Math.floor(Number(raw.wantFanout))))
		: resolveMailboxWantFanout(n, mailboxTunables)
	return { maxHop, relayFanoutTrusted, relayFanoutNormal, wantFanout }
}

/**
 * @param {number} peerCount 已知在线 relay 候选数
 * @param {object} [raw] 节点 mailbox 配置片段
 * @param {boolean} [batterySaver=false] 省电模式
 * @returns {{ maxHop: number, relayFanoutTrusted: number, relayFanoutNormal: number, wantFanout: number, batterySaver: boolean }} 缩放后的路由
 */
export function resolveMailboxRoutingForPeerCount(peerCount, raw = {}, batterySaver = false) {
	const base = normalizeMailboxSettings(raw, peerCount)
	if (!batterySaver) return { ...base, batterySaver: false }
	return {
		maxHop: base.maxHop,
		relayFanoutTrusted: Math.max(1, Math.ceil(base.relayFanoutTrusted / 2)),
		relayFanoutNormal: Math.max(1, Math.ceil(base.relayFanoutNormal / 2)),
		wantFanout: Math.max(1, Math.ceil(base.wantFanout / 2)),
		batterySaver: true,
	}
}

/**
 * @returns {{ maxHop: number, relayFanoutTrusted: number, relayFanoutNormal: number, wantFanout: number, batterySaver: boolean }} mailbox 路由配置
 */
export function getMailboxRoutingSettings() {
	const { batterySaver, mailbox } = getNodeTransportSettings()
	return resolveMailboxRoutingForPeerCount(0, mailbox, batterySaver)
}
