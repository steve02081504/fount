/**
 * pow-challenge HTTP 集成测 bootstrap：建 pow+discoveryPublic 群，写入 setup JSON。
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

/**
 * @param {string} username 用户
 * @returns {Promise<object>} setup
 */
async function setupPowChallenge(username) {
	const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
	await ensureOperatorPubKey(username)
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')

	const groupId = await newGroup(username, { name: 'pow-challenge' })
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: {
			joinPolicy: 'pow',
			discoveryPublic: true,
			powFloorBits: 4,
		},
	})
	const client = await getChatClient(username)
	const group = await client.group(groupId)
	const inviteUrl = await group.createInvite()
	return { groupId, channelId: await getDefaultChannelId(username, groupId), inviteUrl }
}

/**
 * 初始化 PoW challenge 集成测试数据：建 pow+discoveryPublic 群并写入 setup JSON。
 * @param {string} username 测试用户名
 * @returns {Promise<void>}
 */
export default async function bootstrap(username) {
	const setup = await setupPowChallenge(username)
	const dataPath = process.env.FOUNT_TEST_DATA_PATH
	if (dataPath)
		await writeFile(
			join(dataPath, 'pow_challenge_setup.json'),
			JSON.stringify(setup),
			'utf8',
		)
}
