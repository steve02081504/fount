import { httpError } from '../../../../../../scripts/http_error.mjs'
import { resolveSocialEntity } from '../../../../../../scripts/p2p/entity/hosting.mjs'
import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'
import { setPersonalHidden, setPersonalMuted } from '../../../../../../scripts/p2p/personal_block.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { getFederationViewForUser } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { dispatchFollowEvent } from '../dispatch.mjs'
import { setFollow } from '../following.mjs'
import { ensureEntitySocialReady } from '../lib/bootstrap.mjs'
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
		if (!req.body?.entityHash) throw httpError(400, 'entityHash required')
		const target = String(req.body.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			throw httpError(400, 'invalid entityHash')
		const follow = req.body?.follow !== false
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash)
		await setFollow(username, actingEntity, target, follow)
		if (follow) {
			await dispatchFollowEvent(username, actingEntity, target)
			const targetEntity = await resolveSocialEntity(target)
			if (targetEntity?.local && targetEntity.replicaUsername) {
				const followerPubKeyHex = (await getFederationViewForUser(username)).activePubKeyHex
				if (followerPubKeyHex)
					await autoApproveFollower(targetEntity.replicaUsername, target, followerPubKeyHex)
			}
			await syncTimelineForEntity(username, target)
		}
		res.status(200).json({
			entityHash: target,
			actingEntityHash: actingEntity,
			isFollowing: follow,
		})
	})

	router.post('/api/parts/shells\\:social/relationships/block', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			throw httpError(400, 'invalid entityHash')
		if (!await isKnownSocialTarget(username, target))
			throw httpError(400, 'unknown entity')
		const block = req.body?.block !== false
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash, {
			invalidMessage: 'can only block as your operator or local agent entities',
		})
		await ensureEntitySocialReady(username, actingEntity)
		await setPersonalBlock(username, actingEntity, target, block)
		res.status(200).json({
			entityHash: target,
			actingEntityHash: actingEntity,
			blocked: block,
		})
	})

	router.post('/api/parts/shells\\:social/relationships/hide', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			throw httpError(400, 'invalid entityHash')
		if (!await isKnownSocialTarget(username, target))
			throw httpError(400, 'unknown entity')
		const hide = req.body?.hide !== false
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash, {
			invalidMessage: 'can only hide as your operator or local agent entities',
		})
		const hidden = await setPersonalHidden(actingEntity, target, hide)
		res.status(200).json({ entityHash: target, actingEntityHash: actingEntity, hidden })
	})

	router.post('/api/parts/shells\\:social/relationships/mute', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			throw httpError(400, 'invalid entityHash')
		if (!await isKnownSocialTarget(username, target))
			throw httpError(400, 'unknown entity')
		const mute = req.body?.mute !== false
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash, {
			invalidMessage: 'can only mute as your operator or local agent entities',
		})
		await setPersonalMuted(actingEntity, target, mute)
		res.status(200).json({ entityHash: target, actingEntityHash: actingEntity, muted: mute })
	})

	router.post('/api/parts/shells\\:social/relationships/follow-approve', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash)
		const followerPubKeyHex = String(req.body?.followerPubKeyHex)
		if (!followerPubKeyHex)
			throw httpError(400, 'invalid request')
		const payload = await buildFollowApprovePayload(username, actingEntity, followerPubKeyHex)
		const event = await commitTimelineEvent(username, actingEntity, {
			type: 'follow_approve',
			content: payload,
		})
		res.status(200).json({ event })
	})
}
