/**
 * FOUNT_TEST 专用：Playwright / live 探针注入联邦互动通知。
 */
import { httpError } from '../../../../../../scripts/http_error.mjs'
import { pubKeyHash, publicKeyFromSeed } from '../../../../../../scripts/p2p/crypto.mjs'
import { appendJsonlSynced } from '../../../../../../scripts/p2p/dag/storage.mjs'
import { encodeEntityHash } from '../../../../../../scripts/p2p/entity_id.mjs'
import { getUserByReq } from '../../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHashForUser } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { seedRemoteTimeline, randomSeed } from '../../test/federation/remote_timeline.mjs'
import { FOREIGN_FE_AUTHOR_HASH, FOREIGN_FE_SEED } from '../../test/seedForeignFeedAuthor.mjs'
import { inboxEventsPath } from '../inbox.mjs'

/**
 * @returns {void}
 */
function assertTestMode() {
	if (process.env.FOUNT_TEST !== '1' && process.env.FOUNT_TEST_ISOLATED !== '1')
		throw httpError(404, 'not found')
}

/**
 * @param {import('npm:express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权
 * @returns {void}
 */
export function registerTestSeedRoutes(router, authenticate) {
	router.post('/api/parts/shells\\:social/test/foreign-like', authenticate, async (req, res) => {
		assertTestMode()
		const { username } = getUserByReq(req)
		const targetEntityHash = String(req.body?.targetEntityHash || '').trim().toLowerCase()
		const targetPostId = String(req.body?.targetPostId || '').trim()
		if (!targetEntityHash || !targetPostId)
			throw httpError(400, 'targetEntityHash and targetPostId required')
		await seedRemoteTimeline(username, FOREIGN_FE_SEED, FOREIGN_FE_AUTHOR_HASH, [
			{ type: 'like', content: { targetEntityHash, targetPostId } },
		])
		res.status(200).json({})
	})

	router.post('/api/parts/shells\\:social/test/inbox-likes', authenticate, async (req, res) => {
		assertTestMode()
		const { username } = getUserByReq(req)
		const targetEntityHash = String(req.body?.targetEntityHash || '').trim().toLowerCase()
		const targetPostId = String(req.body?.targetPostId || '').trim()
		const count = Math.min(Math.max(Number(req.body?.count) || 2, 1), 200)
		if (!targetEntityHash || !targetPostId)
			throw httpError(400, 'targetEntityHash and targetPostId required')
		const eventsPath = inboxEventsPath(username, targetEntityHash)
		for (let index = 0; index < count; index++) {
			const seed = randomSeed()
			const actor = encodeEntityHash('4'.repeat(64), pubKeyHash(publicKeyFromSeed(seed)))
			await appendJsonlSynced(eventsPath, {
				type: 'like',
				actorEntityHash: actor,
				postId: null,
				targetPostId,
				targetEntityHash,
				snippet: 'aggregated like target',
				at: Date.now() - index,
			})
		}
		res.status(200).json({ count })
	})

	router.post('/api/parts/shells\\:social/test/inbox-mentions', authenticate, async (req, res) => {
		assertTestMode()
		const { username } = getUserByReq(req)
		const count = Math.min(Math.max(Number(req.body?.count) || 41, 1), 200)
		const viewerEntityHash = (await resolveOperatorEntityHashForUser(username))?.toLowerCase()
		if (!viewerEntityHash)
			throw httpError(400, 'identity required')
		const eventsPath = inboxEventsPath(username, viewerEntityHash)
		for (let index = 0; index < count; index++) {
			const seed = randomSeed()
			const actor = encodeEntityHash('4'.repeat(64), pubKeyHash(publicKeyFromSeed(seed)))
			await appendJsonlSynced(eventsPath, {
				type: 'mention',
				actorEntityHash: actor,
				postId: `seed-mention-${index}`,
				targetPostId: null,
				snippet: `seed mention ${index}`,
				at: Date.now() - index,
			})
		}
		res.status(200).json({ count })
	})
}
