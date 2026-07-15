/**
 * 联邦直播观众代理：本节点连主播 public watch bridge，多本地观众复用。
 */
import WebSocket from 'npm:ws'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import {
	injectAvRelayFrame,
} from '../../../chat/src/chat/ws/avRelay.mjs'

import { ingestBridgedLiveSignal } from './hub.mjs'
import {
	loadLiveSession,
	mintLiveBridgeToken,
	saveLiveSession,
} from './session.mjs'

/** @type {Map<string, { closer: () => void, session: object }>} */
const proxies = new Map()

/**
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {string} key
 */
function proxyKey(entityHash, liveId) {
	return `${entityHash.toLowerCase()}:${String(liveId).toLowerCase()}`
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @param {{ bridgeOrigin?: string, nodeHash?: string, title?: string, watchSecret?: string }} hint 发现条目
 * @returns {Promise<object>} session
 */
export async function ensureFederatedLiveProxy(username, entityHash, liveId, hint = {}) {
	const existing = loadLiveSession(username, entityHash, liveId)
	if (existing?.status === 'live' && !existing.federatedProxy) return existing
	if (existing?.status === 'live' && existing.federatedProxy && proxies.has(proxyKey(entityHash, liveId)))
		return existing

	const key = proxyKey(entityHash, liveId)
	if (proxies.has(key)) return proxies.get(key).session

	const bridgeOrigin = String(hint.bridgeOrigin || '').replace(/\/$/, '')
	const watchSecret = String(hint.watchSecret || '')
	if (!bridgeOrigin || !watchSecret) throw httpError(404, 'live not reachable')

	const avRoomId = `social-proxy:${entityHash}:${liveId}`
	const session = {
		liveId: String(liveId).toLowerCase(),
		entityHash: entityHash.toLowerCase(),
		title: hint.title || 'Live',
		visibility: 'public',
		status: 'live',
		startedAt: Date.now(),
		viewerCount: 0,
		likeCount: 0,
		avRoomId,
		federatedProxy: true,
		bridgeOrigin,
		nodeHash: hint.nodeHash || '',
		stats: { viewerHashes: [], peakViewers: 0, likeCount: 0 },
	}
	saveLiveSession(username, entityHash, session)

	const token = mintLiveBridgeToken(watchSecret, entityHash, liveId)
	const wsUrl = `${bridgeOrigin.replace(/^http/, 'ws')}/ws/parts/shells:social/live-bridge/${encodeURIComponent(entityHash)}/${encodeURIComponent(liveId)}?token=${encodeURIComponent(token)}`

	let remote
	try {
		remote = new WebSocket(wsUrl)
		await new Promise((resolve, reject) => {
			remote.once('open', resolve)
			remote.once('error', reject)
			setTimeout(() => reject(new Error('proxy timeout')), 8_000)
		})
	}
	catch (error) {
		session.status = 'ended'
		saveLiveSession(username, entityHash, session)
		throw httpError(502, `live proxy failed: ${error?.message || error}`)
	}

	remote.on('message', (data, isBinary) => {
		if (isBinary) {
			injectAvRelayFrame(avRoomId, data)
			return
		}
		let msg
		try { msg = JSON.parse(String(data)) }
		catch { return }
		ingestBridgedLiveSignal(username, entityHash, liveId, msg)
	})

	const closer = () => {
		try { remote.close() } catch { /* ignore */ }
		proxies.delete(key)
	}
	remote.on('close', closer)
	proxies.set(key, { closer, session })
	return session
}
