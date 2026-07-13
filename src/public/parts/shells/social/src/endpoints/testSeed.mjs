/**
 * FOUNT_TEST 专用：Playwright / live 探针注入联邦互动通知。
 */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { agentEntityHash } from 'fount/public/parts/shells/chat/src/chat/lib/entity.mjs'
import { encodeEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pubKeyHash, publicKeyFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { appendJsonlSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { getUserByReq, getUserDictionary } from '../../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHashForUser } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { seedRemoteTimeline, randomSeed } from '../../test/federation/remote_timeline.mjs'
import { FOREIGN_FE_AUTHOR_HASH, FOREIGN_FE_SEED } from '../../test/seedForeignFeedAuthor.mjs'
import { inboxEventsPath } from '../inbox.mjs'
import { ensureEntitySocialReady } from '../lib/bootstrap.mjs'

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

	router.post('/api/parts/shells\\:social/test/seed-local-agent', authenticate, async (req, res) => {
		assertTestMode()
		const { username } = getUserByReq(req)
		const charPartName = String(req.body?.charPartName || 'social_on_message_probe').trim()
		const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/chars')
		const from = join(fixturesRoot, charPartName)
		const to = join(getUserDictionary(username), 'chars', charPartName)
		await mkdir(to, { recursive: true })
		await cp(from, to, { recursive: true })
		const entityHash = agentEntityHash(getNodeHash(), `chars/${charPartName}`)
		await ensureEntitySocialReady(username, entityHash)
		res.status(200).json({ entityHash, charPartName })
	})

	router.post('/api/parts/shells\\:social/test/inbox-mention-for', authenticate, async (req, res) => {
		assertTestMode()
		const { username } = getUserByReq(req)
		const recipientEntityHash = String(req.body?.recipientEntityHash || '').trim().toLowerCase()
		if (!recipientEntityHash)
			throw httpError(400, 'recipientEntityHash required')
		const seed = randomSeed()
		const actor = encodeEntityHash('4'.repeat(64), pubKeyHash(publicKeyFromSeed(seed)))
		const postId = String(req.body?.postId || `seed-mention-${Date.now()}`)
		await appendJsonlSynced(inboxEventsPath(username, recipientEntityHash), {
			type: 'mention',
			actorEntityHash: actor,
			postId,
			targetPostId: null,
			snippet: String(req.body?.snippet || 'agent acting mention'),
			at: Date.now(),
		})
		res.status(200).json({ postId, recipientEntityHash })
	})
}
