import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import {
	addDenylistEntry,
	loadDenylist,
} from 'npm:@steve02081504/fount-p2p/node/denylist'
import { loadNetwork } from 'npm:@steve02081504/fount-p2p/node/network'

import {
	getFederationViewForUser,
	saveFederationViewForUser,
} from '../../public/parts/shells/chat/src/entity/identity.mjs'
import { authenticate, getUserByReq } from '../auth/index.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerP2pEndpoints(router) {
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
		const dmIntroNonce = String(body.dmIntroNonce || '').trim()
		if (dmIntroNonce.length >= 16) patch.dmIntroNonce = dmIntroNonce
		res.status(200).json(await saveFederationViewForUser(username, patch))
	})

	router.post('/api/p2p/federation/connect-node', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const targetNodeHash = String(req.body?.targetNodeHash || '').trim().toLowerCase()
		if (!isHex64(targetNodeHash))
			return res.status(400).json({ error: 'invalid targetNodeHash' })
		const { ensureRemoteUserRoom } = await import('npm:@steve02081504/fount-p2p/transport/remote_user_room')
		const slot = await ensureRemoteUserRoom(username, targetNodeHash)
		res.status(200).json({ targetNodeHash, connected: !!slot })
	})

	router.get('/api/p2p/network', authenticate, async (req, res) => {
		void getUserByReq(req)
		res.status(200).json(loadNetwork())
	})

	router.get('/api/p2p/denylist', authenticate, async (req, res) => {
		void getUserByReq(req)
		res.status(200).json(loadDenylist())
	})

	router.post('/api/p2p/denylist', authenticate, async (req, res) => {
		void getUserByReq(req)
		const body = req.body || {}
		const scope = String(body.scope || '').trim().toLowerCase()
		const value = String(body.value || '').trim()
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
		void getUserByReq(req)
		const { countMailboxPending } = await import('npm:@steve02081504/fount-p2p/mailbox/store')
		const pendingCount = await countMailboxPending()
		res.status(200).json({ pendingCount })
	})
}
