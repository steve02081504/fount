import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import {
	addDenylistEntry,
	loadDenylist,
} from 'npm:@steve02081504/fount-p2p/node/denylist'
import { isNodeInitialized } from 'npm:@steve02081504/fount-p2p/node/instance'
import { loadNetwork } from 'npm:@steve02081504/fount-p2p/node/network'

import {
	getFederationViewForUser,
	saveFederationViewForUser,
} from '../../public/parts/shells/chat/src/entity/identity.mjs'
import { is_local_ip_from_req } from '../../scripts/ratelimit.mjs'
import { authenticate, getUserByReq } from '../auth/index.mjs'
import { getNetworkVerificationService, proveNetworkVerification } from '../p2p_server/verification.mjs'

/**
 * 将 Pages 浏览器探测限制在本机和官方验证页。
 * @param {import('npm:express').Request} req 请求
 * @param {import('npm:express').Response} res 响应
 * @param {import('npm:express').NextFunction} next 下一处理器
 * @returns {void} 无返回值
 */
function verificationLocalCors(req, res, next) {
	if (!is_local_ip_from_req(req)) {
		res.status(403).end()
		return
	}
	const origin = req.headers.origin
	if (origin && origin !== 'https://steve02081504.github.io') {
		res.status(403).end()
		return
	}
	res.setHeader('Access-Control-Allow-Origin', 'https://steve02081504.github.io')
	res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
	res.setHeader('Access-Control-Allow-Private-Network', 'true')
	res.setHeader('Cache-Control', 'no-store')
	res.vary('Origin')
	if (req.method === 'OPTIONS') { res.status(204).end(); return }
	next()
}

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerP2pEndpoints(router) {
	router.options('/api/p2p/verification/local', verificationLocalCors)
	router.post('/api/p2p/verification', authenticate, (req, res) => {
		if (!isNodeInitialized()) return res.status(503).json({ error: 'P2P unavailable' })
		try {
			const challenge = getNetworkVerificationService().create({ timeoutMs: req.body?.timeoutMs })
			const url = new URL('https://steve02081504.github.io/fount/captcha/')
			for (const key of ['requesterNodeHash', 'challenge', 'expiresAt']) url.searchParams.set(key, challenge[key])
			res.json({ ...challenge, url: url.href })
		}
		catch (error) { res.status(400).json({ error: error.message }) }
	})
	router.get('/api/p2p/verification/status/:challenge', authenticate, (req, res) => {
		if (!isNodeInitialized()) return res.status(503).json({ error: 'P2P unavailable' })
		const result = getNetworkVerificationService().get(req.params.challenge)
		if (!result) return res.status(404).json({ error: 'unknown challenge' })
		res.json(result)
	})
	router.get('/api/p2p/verification/local', verificationLocalCors, async (req, res) => {
		if (!isNodeInitialized()) return res.status(503).json({ status: 'failed', reason: 'P2P unavailable' })
		res.json(await proveNetworkVerification({
			requesterNodeHash: req.query.requesterNodeHash,
			challenge: req.query.challenge,
			expiresAt: Number(req.query.expiresAt),
		}))
	})
	router.get('/api/p2p/federation', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await getFederationViewForUser(username))
	})

	router.put('/api/p2p/federation', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const body = req.body || {}
		const patch = {}
		if (body.batterySaver != null) patch.batterySaver = !!body.batterySaver
		if (Array.isArray(body.relayUrls)) patch.relayUrls = body.relayUrls
		if (body.mailbox) patch.mailbox = body.mailbox
		const dmIntroNonce = String(body.dmIntroNonce ?? '').trim()
		if (dmIntroNonce.length >= 16) patch.dmIntroNonce = dmIntroNonce
		res.status(200).json(await saveFederationViewForUser(username, patch))
	})

	router.post('/api/p2p/federation/connect-node', authenticate, async (req, res) => {
		const targetNodeHash = String(req.body?.targetNodeHash ?? '').trim()
		if (!isHex64(targetNodeHash))
			return res.status(400).json({ error: 'invalid targetNodeHash' })
		const { ensureRemoteUserRoom } = await import('npm:@steve02081504/fount-p2p/transport/remote_user_room')
		const slot = await ensureRemoteUserRoom(targetNodeHash)
		res.status(200).json({ targetNodeHash, connected: !!slot })
	})

	router.get('/api/p2p/network', authenticate, async (req, res) => {
		res.status(200).json(loadNetwork())
	})

	router.get('/api/p2p/denylist', authenticate, async (req, res) => {
		res.status(200).json(loadDenylist())
	})

	router.post('/api/p2p/denylist', authenticate, async (req, res) => {
		const body = req.body || {}
		const scope = String(body.scope ?? '').trim()
		const value = String(body.value ?? '').trim()
		if (!scope || !value)
			return res.status(400).json({ error: 'scope and value required' })
		await addDenylistEntry({
			scope,
			value,
			groupId: body.groupId,
		})
		res.status(200).json(loadDenylist())
	})

	router.get('/api/p2p/mailbox/summary', authenticate, async (req, res) => {
		const { countMailboxPending } = await import('npm:@steve02081504/fount-p2p/mailbox/store')
		const pendingCount = await countMailboxPending()
		res.status(200).json({ pendingCount })
	})
}
