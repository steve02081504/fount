import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'
import { setPersonalHidden } from '../../../../../../scripts/p2p/personal_block.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { getFederationViewForUser } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { dispatchFollowEvent } from '../dispatch.mjs'
import { setFollow } from '../following.mjs'
import { ensureEntitySocialReady } from '../lib/bootstrap.mjs'
import { resolveSocialEntity } from '../lib/entityResolve.mjs'
import { isKnownSocialTarget } from '../lib/entityTarget.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'
import { setPersonalBlock } from '../personalBlock.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { syncTimelineForEntity } from '../timeline/sync.mjs'
import { autoApproveFollower } from '../vault_crypto/followApprove.mjs'
import { buildFollowApprovePayload } from '../vault_crypto/vault.mjs'

/**
 * 注册关注、拉黑等关系写路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerRelationshipsRoutes(router) {
	router.post('/api/parts/shells\\:social/relationships/follow', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			return res.status(400).json({ error: 'invalid entityHash' })
		if (!await isKnownSocialTarget(username, target))
			return res.status(400).json({ error: 'unknown entity' })
		const follow = req.body?.follow !== false
		await setFollow(username, target, follow)
		const acting = await resolveActingEntity(username, req.body?.actingEntityHash)
		if (acting.error)
			return res.status(acting.status).json({ error: acting.error })
		const self = acting.actingEntity
		if (self && follow) {
			await dispatchFollowEvent(username, self, target)
			const targetEntity = await resolveSocialEntity(target)
			if (targetEntity?.local && targetEntity.replicaUsername) {
				const followerPubKeyHex = (await getFederationViewForUser(username)).activePubKeyHex
				if (followerPubKeyHex)
					await autoApproveFollower(targetEntity.replicaUsername, target, followerPubKeyHex)
			}
			await syncTimelineForEntity(username, target)
		}
		res.status(200).json({ entityHash: target, isFollowing: follow })
	})

	router.post('/api/parts/shells\\:social/relationships/block', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			return res.status(400).json({ error: 'invalid entityHash' })
		if (!await isKnownSocialTarget(username, target))
			return res.status(400).json({ error: 'unknown entity' })
		const block = req.body?.block !== false
		const acting = await resolveActingEntity(username, req.body?.actingEntityHash, {
			invalidMessage: 'can only block as your operator or local agent entities',
		})
		if (acting.error)
			return res.status(acting.status).json({ error: acting.error })
		await ensureEntitySocialReady(username, acting.actingEntity)
		await setPersonalBlock(username, acting.actingEntity, target, block)
		res.status(200).json({
			entityHash: target,
			actingEntityHash: acting.actingEntity,
			blocked: block,
		})
	})

	router.post('/api/parts/shells\\:social/relationships/hide', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			return res.status(400).json({ error: 'invalid entityHash' })
		if (!await isKnownSocialTarget(username, target))
			return res.status(400).json({ error: 'unknown entity' })
		const hide = req.body?.hide !== false
		const acting = await resolveActingEntity(username, req.body?.actingEntityHash, {
			invalidMessage: 'can only hide as your operator or local agent entities',
		})
		if (acting.error)
			return res.status(acting.status).json({ error: acting.error })
		const hidden = await setPersonalHidden(acting.actingEntity, target, hide)
		res.status(200).json({ entityHash: target, actingEntityHash: acting.actingEntity, hidden })
	})

	router.post('/api/parts/shells\\:social/relationships/follow-approve', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const acting = await resolveActingEntity(username, req.body?.actingEntityHash)
		if (acting.error)
			return res.status(acting.status).json({ error: acting.error })
		const followerPubKeyHex = String(req.body?.followerPubKeyHex)
		if (!followerPubKeyHex)
			return res.status(400).json({ error: 'invalid request' })
		const payload = await buildFollowApprovePayload(username, acting.actingEntity, followerPubKeyHex)
		const event = await commitTimelineEvent(username, acting.actingEntity, {
			type: 'follow_approve',
			content: payload,
		})
		res.status(200).json({ event })
	})
}
