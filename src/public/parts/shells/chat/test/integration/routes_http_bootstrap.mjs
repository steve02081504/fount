/**
 * HTTP 路由集成测 bootstrap：按 FOUNT_TEST_HTTP_SCENARIO 建群并写入 setup JSON。
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const WORLD_VIEWLOG = 'human_viewer'
const PERSONA_VIEWLOG = 'viewer_persona'
const WORLD_EDIT = 'edit_path_world'
const PERSONA_EDIT = 'edit_path_persona'
const PERSONA_WRITE = 'write_path_persona'

/**
 * @param {string} username replica 登录名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} text 消息正文
 * @returns {Promise<void>}
 */
async function postText(username, groupId, channelId, text) {
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	await postChannelMessage(username, groupId, channelId, { text })
}

/**
 * @param {object[]} rows 消息行
 * @param {string} needle 子串
 * @returns {string | null} eventId
 */
function findEventId(rows, needle) {
	const row = rows.find(m => String(m.content?.content || '').includes(needle))
	return row?.eventId ? String(row.eventId) : null
}

/**
 * @param {string} username 用户
 * @returns {Promise<{ groupId: string, channelId: string }>} 新群
 */
async function createBaseGroup(username) {
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const groupId = await newGroup(username, { name: 'routes-http' })
	const channelId = await getDefaultChannelId(username, groupId)
	return { groupId, channelId }
}

/**
 * @param {string} username 用户
 * @returns {Promise<object>} setup
 */
async function setupViewlog(username) {
	const { bindWorld, setPersona } = await import('../../src/chat/session/partConfig.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { groupId, channelId } = await createBaseGroup(username)
	await bindWorld(groupId, channelId, WORLD_VIEWLOG, username)
	await setPersona(groupId, PERSONA_VIEWLOG, username)
	await postText(username, groupId, channelId, 'hello visible')
	await postText(username, groupId, channelId, 'secret hidden-marker payload')
	await postText(username, groupId, channelId, 'persona-hide-me private note')
	const rows = await readChannelMessagesForUser(username, groupId, channelId, { limit: 50 })
	return {
		groupId,
		channelId,
		oldestEventId: rows[0]?.eventId ? String(rows[0].eventId) : null,
	}
}

/**
 * @param {string} username 用户
 * @returns {Promise<object>} setup
 */
async function setupBeforeSendReject(username) {
	const { setPersona } = await import('../../src/chat/session/partConfig.mjs')
	const { groupId, channelId } = await createBaseGroup(username)
	await setPersona(groupId, PERSONA_WRITE, username)
	return { groupId, channelId }
}

/**
 * @param {string} username 用户
 * @returns {Promise<object>} setup
 */
async function setupEditHooks(username) {
	const { bindWorld, setPersona } = await import('../../src/chat/session/partConfig.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { groupId, channelId } = await createBaseGroup(username)
	await setPersona(groupId, PERSONA_EDIT, username)
	await bindWorld(groupId, channelId, WORLD_EDIT, username)
	await postText(username, groupId, channelId, 'seed persona-edit-me world-edit-me')
	await postText(username, groupId, channelId, 'keep persona-delete-reject')
	const rows = await readChannelMessagesForUser(username, groupId, channelId, { limit: 50 })
	return {
		groupId,
		channelId,
		editEventId: findEventId(rows, 'persona-edit-me'),
		deleteRejectEventId: findEventId(rows, 'persona-delete-reject'),
	}
}

/**
 * @param {string} username 用户
 * @returns {Promise<object>} setup
 */
async function setupEntityPresence(username) {
	const { groupId, channelId } = await createBaseGroup(username)
	return { groupId, channelId }
}

/** @type {Record<string, (username: string) => Promise<object>>} */
const SCENARIOS = {
	viewlog: setupViewlog,
	before_send_reject: setupBeforeSendReject,
	edit_hooks: setupEditHooks,
	entity_presence: setupEntityPresence,
}

/**
 * @param {string} username 测试用户名
 * @returns {Promise<void>}
 */
export default async function bootstrap(username) {
	const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
	await ensureOperatorPubKey(username)

	const dataPath = process.env.FOUNT_TEST_DATA_PATH
	const scenario = process.env.FOUNT_TEST_HTTP_SCENARIO || 'viewlog'
	const setupFn = SCENARIOS[scenario]
	if (!setupFn)
		throw new Error(`unknown FOUNT_TEST_HTTP_SCENARIO: ${scenario}`)

	const setup = await setupFn(username)
	if (dataPath)
		await writeFile(
			join(dataPath, 'routes_http_setup.json'),
			JSON.stringify({ scenario, ...setup }),
			'utf8',
		)
}
