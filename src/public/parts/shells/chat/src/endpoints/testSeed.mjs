/**
 * FOUNT_TEST 专用：Playwright 注入跨群 @mention（经 broadcastAndPersist → maybeAppendMentionInbox）。
 */
import { randomBytes } from 'node:crypto'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { getUserByReq } from '../../../../../../server/auth/index.mjs'
import { broadcastAndPersist } from '../chat/dag/eventPersist.mjs'
import { resolveOperatorEntityHash } from '../chat/lib/replica.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

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
	router.post(`${CHAT_API_PREFIX}/test/mention-inbox`, authenticate, async (req, res) => {
		assertTestMode()
		const { username } = getUserByReq(req)
		const groupId = String(req.body?.groupId || '').trim()
		const channelId = String(req.body?.channelId || 'default').trim()
		const previewText = String(req.body?.text || `mention-e2e ${Date.now()}`)
		if (!groupId) throw httpError(400, 'groupId required')
		const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
		if (!viewerEntityHash) throw httpError(400, 'identity required')

		const eventId = randomBytes(32).toString('hex')
		const senderKey = randomBytes(32).toString('hex')
		const at = Date.now()
		const text = `${previewText} @${viewerEntityHash}`

		await broadcastAndPersist(username, groupId, {
			id: eventId,
			type: 'message',
			channelId,
			sender: senderKey,
			content: { type: 'text', content: text },
			timestamp: at,
			hlc: { wall: at },
			prev_event_ids: [],
		}, { skipCheckpointRebuild: true, skipGenesisSideEffects: true })

		await new Promise(resolve => setTimeout(resolve, 100))
		res.status(200).json({ eventId, text: previewText, groupId, channelId })
	})
}
