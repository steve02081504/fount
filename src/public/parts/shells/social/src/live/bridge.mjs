/**
 * 跨节点直播 bridge：出站连对端 live-bridge WS；帧订阅 → 远端，入站注入本地房间。
 */
import WebSocket from 'npm:ws'

import {
	injectAvRelayFrame,
	injectAvRelayControl,
	subscribeAvRelayFrames,
	subscribeAvRelayControls,
} from '../../../chat/src/chat/ws/avRelay.mjs'

import { ingestBridgedLiveSignal } from './hub.mjs'
import { liveBridgeTokenFor } from './link.mjs'
import { loadLiveSession } from './session.mjs'

/**
 * @param {object} opts 参数
 * @returns {Promise<() => void>} closer
 */
export async function connectOutboundLiveBridge(opts) {
	const {
		username,
		entityHash,
		liveId,
		avRoomId,
		peerBridgeOrigin,
		peerEntityHash,
		peerLiveId,
		linkSecret,
	} = opts
	const token = liveBridgeTokenFor(linkSecret, peerEntityHash, peerLiveId)
	const base = String(peerBridgeOrigin || '').replace(/\/$/, '')
	const wsUrl = `${base.replace(/^http/, 'ws')}/ws/parts/shells:social/live-bridge/${encodeURIComponent(peerEntityHash)}/${encodeURIComponent(peerLiveId)}?token=${encodeURIComponent(token)}`

	const remote = new WebSocket(wsUrl)
	await new Promise((resolve, reject) => {
		remote.once('open', resolve)
		remote.once('error', reject)
		setTimeout(() => reject(new Error('bridge connect timeout')), 8_000)
	})

	const unsub = subscribeAvRelayFrames(avRoomId, buf => {
		if (remote.readyState !== 1) return
		try { remote.send(buf, { binary: true }) }
		catch { /* skip */ }
	})
	const unsubCtrl = subscribeAvRelayControls(avRoomId, text => {
		if (remote.readyState !== 1) return
		try { remote.send(text) }
		catch { /* skip */ }
	})

	remote.on('message', (data, isBinary) => {
		if (isBinary) {
			injectAvRelayFrame(avRoomId, data)
			return
		}
		let msg
		try { msg = JSON.parse(String(data)) }
		catch { return }
		if (msg?.type === 'publish_meta' || msg?.type === 'publish_meta_revoke') {
			injectAvRelayControl(avRoomId, msg)
			return
		}
		ingestBridgedLiveSignal(username, entityHash, liveId, msg)
	})

	const statsTimer = setInterval(() => {
		const session = loadLiveSession(username, entityHash, liveId)
		if (!session || remote.readyState !== 1) return
		try {
			remote.send(JSON.stringify({
				type: 'link_stats',
				viewerCount: session.viewerCount || 0,
				likeCount: session.likeCount || 0,
				origin: `${entityHash}:${liveId}`,
			}))
		}
		catch { /* skip */ }
	}, 3000)

	let closed = false
	/**
	 *
	 */
	const close = () => {
		if (closed) return
		closed = true
		clearInterval(statsTimer)
		unsub()
		unsubCtrl()
		try { remote.close() } catch { /* ignore */ }
	}
	remote.on('close', close)
	return close
}
