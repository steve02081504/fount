/**
 * P2P 关闭时 char Load 仍需能创建本地实体身份（fount#344 / fount-p2p#35）。
 */
/* global Deno */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot, seedCharFixture } from '../harness.mjs'

const CHAR = 'gentian_shell_contract'

Deno.test('char Load creates local entity identity while P2P is disabled', async () => {
	const username = `eio-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: false,
		p2p: false,
		/**
		 * @param {string} user fount 用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			await seedCharFixture(dataDir, user, CHAR)
		},
	})
	await ensureServer()

	const { isNodeInitialized } = await import('npm:@steve02081504/fount-p2p/node/instance')
	assertEquals(isNodeInitialized(), false)

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const charAPI = await loadPart(username, `chars/${CHAR}`)
	assertEquals(typeof charAPI?.interfaces?.chat?.OnMessage, 'function')

	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')
	const operatorHash = await resolveOperatorEntityHashForUser(username)
	assertEquals(typeof operatorHash, 'string')
	assertEquals(operatorHash.length, 128)
	const agentHash = await ensureLocalAgentEntityHash(username, CHAR)
	assertEquals(agentHash.length, 128)
	assertEquals(agentHash === operatorHash, false)

	const entitiesRoot = join(dataDir, 'users', username, 'entities')
	const operatorRow = JSON.parse(await readFile(join(entitiesRoot, operatorHash, 'identity.json'), 'utf8'))
	const agentRow = JSON.parse(await readFile(join(entitiesRoot, agentHash, 'identity.json'), 'utf8'))
	assertEquals(operatorRow.charPartName ?? null, null)
	assertEquals(agentRow.charPartName, CHAR)
	assertEquals(String(agentRow.ownerEntityHash).toLowerCase(), operatorHash.toLowerCase())

	// 本地 seed 落在 dataPath/p2p/node，且 entityHash 的 nodeHash 与之一致；此过程始终不初始化节点。
	const { getNodeDir } = await import('npm:@steve02081504/fount-p2p/node/instance')
	const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
	const { parseEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')
	assertEquals(existsSync(join(dataDir, 'p2p', 'node', 'node.json')), true)
	assertEquals(getNodeHash().length, 64)
	assertEquals(getNodeDir(), join(dataDir, 'p2p', 'node'))
	assertEquals(parseEntityHash(operatorHash).nodeHash, getNodeHash())
	assertEquals(isNodeInitialized(), false)
})
