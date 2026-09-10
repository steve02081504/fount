/**
 * 共享文件柜 `cabinet_operation_pull` 为 P2P 入站：只应对本机参与者返回操作日志，
 * 且 `cabinetId` 必须形校验，避免凭 id 泄露/路径穿越读取 operations.jsonl。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'
import { randomKeyPair } from 'npm:@steve02081504/fount-p2p/crypto'

import { bootHeadlessDataRoot } from 'fount/scripts/test/node/boot.mjs'

import { sharedCabinetOperationsPath } from '../../src/paths.mjs'
import { writeIdentityFromSecret } from '../../src/shared/crypto.mjs'
import { exportMissingSharedOperations, handleCabinetP2PInvoke } from '../../src/shared/sync.mjs'

/**
 * @param {string} operationId 操作 id
 * @returns {string} operations.jsonl 行
 */
function operationLine(operationId) {
	return `${JSON.stringify({
		operation_id: operationId,
		hlc: { wall: 1, logical: 0 },
		gen: 0,
		entry_id: 'e1',
		action: 'upsert',
		payload_ciphertext: null,
	})}\n`
}

Deno.test({
	name: 'shared cabinet operation pull requires participation and a safe cabinetId',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const dataPath = join(tmpdir(), `fount_cabinet_pull_${crypto.randomUUID()}`)
	await bootHeadlessDataRoot(dataPath)
	const username = `u_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
	try {
		const { secretKey, publicKey } = await randomKeyPair()
		const { cabinetId } = writeIdentityFromSecret(secretKey)
		const sharedRoot = join(dataPath, 'users', username, 'shells', 'cabinet', 'shared')

		const participantDir = join(sharedRoot, cabinetId)
		await mkdir(participantDir, { recursive: true })
		await writeFile(join(participantDir, 'keys.json'), JSON.stringify({
			write_pubkey: Buffer.from(publicKey).toString('hex'),
			read_keys: [],
			current_gen: 0,
		}))
		await writeFile(sharedCabinetOperationsPath(username, cabinetId), operationLine('op-1'))

		// 参与者：可拉取
		assertEquals((await exportMissingSharedOperations(username, cabinetId, [])).length, 1)
		const viaInvoke = await handleCabinetP2PInvoke(username, {
			kind: 'cabinet_operation_pull',
			cabinetId,
			haveOperationIds: [],
		})
		assertEquals(viaInvoke.result.operations.length, 1)

		// 非参与者（无 keys.json）：即使磁盘上有 op 文件也不得泄露
		const strangerId = 'a'.repeat(64)
		const strangerDir = join(sharedRoot, strangerId)
		await mkdir(strangerDir, { recursive: true })
		await writeFile(sharedCabinetOperationsPath(username, strangerId), operationLine('leak'))
		assertEquals(await exportMissingSharedOperations(username, strangerId, []), [])
		const stranger = await handleCabinetP2PInvoke(username, {
			kind: 'cabinet_operation_pull',
			cabinetId: strangerId,
			haveOperationIds: [],
		})
		assertEquals(stranger.result.operations, [])

		// 路径穿越 id：拒绝，不得读到参与者的 operations.jsonl
		const traversal = `../../users/${username}/shells/cabinet/shared/${cabinetId}`
		assertEquals(await exportMissingSharedOperations(username, traversal, []), [])
	}
	finally {
		await rm(dataPath, { recursive: true, force: true })
	}
})
