/**
 * M4：OnMention 缺失时回退 chat.GetReply。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR = 'mention_getreply_agent'

const getSession = createTestSession()
const append = await import('../../src/timeline/append.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const { agentEntityHash } = await import('fount/scripts/p2p/entity_id.mjs')
const { getNodeHash } = await import('fount/scripts/p2p/node/identity.mjs')
const { getUserDictionary } = await import('fount/server/auth/index.mjs')

/**
 * @param {string} username replica
 * @returns {Promise<string>} agent entityHash
 */
async function seedMentionAgentChar(username) {
	const to = join(getUserDictionary(username), 'chars', CHAR)
	await mkdir(to, { recursive: true })
	await cp(join(fixturesRoot, 'chars', CHAR), to, { recursive: true })
	return agentEntityHash(getNodeHash(), `chars/${CHAR}`)
}

Deno.test('dispatchPostMentions falls back to chat.GetReply when OnMention missing', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedMentionAgentChar(username)
	const post = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `ping @${agentHash}`, visibility: 'public' },
	}, { fanout: false })

	await dispatch.dispatchPostMentions(username, operator, post)

	const agentTimeline = await append.readTimelineEvents(username, agentHash)
	const reply = agentTimeline.find(ev =>
		ev.type === 'post' && String(ev.content?.text || '').includes('mention-getreply-fallback'))
	assert(reply, 'agent should publish GetReply fallback')
	assertEquals(reply.content.replyTo?.entityHash, operator)
})
