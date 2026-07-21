import { appendFile, readFile } from 'node:fs/promises'

import { mutateReputation } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { ensureParentDir } from '../io.mjs'
import { sharedCabinetOperationsPath } from '../paths.mjs'

import { verifyOperation } from './crypto.mjs'

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<object[]>} 操作列表
 */
export async function loadSharedOperations(username, cabinetId) {
	try {
		const text = await readFile(sharedCabinetOperationsPath(username, cabinetId), 'utf8')
		return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
	}
	catch {
		return []
	}
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object} operation 已签名操作
 * @returns {Promise<void>}
 */
export async function appendSharedOperation(username, cabinetId, operation) {
	const path = sharedCabinetOperationsPath(username, cabinetId)
	await ensureParentDir(path)
	await appendFile(path, `${JSON.stringify(operation)}\n`, 'utf8')
}

/**
 * 接收远端/本地操作：验签通过则追加（幂等按 operation_id）。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object} operation 操作
 * @param {Uint8Array | string} writePublicKey 写公钥
 * @param {{ peerNodeHash?: string, knownOperationIds?: Set<string> }} [options] 选项
 * @returns {Promise<'accepted' | 'duplicate' | 'rejected'>} 结果
 */
export async function ingestSharedOperation(username, cabinetId, operation, writePublicKey, options = {}) {
	const knownOperationIds = options.knownOperationIds
		?? new Set((await loadSharedOperations(username, cabinetId)).map(operation => operation.operation_id))
	if (knownOperationIds.has(operation.operation_id)) return 'duplicate'
	if (!await verifyOperation(operation, writePublicKey)) {
		if (options.peerNodeHash)
			mutateReputation(rep => {
				const node = String(options.peerNodeHash)
				if (!rep.nodes) rep.nodes = {}
				if (!rep.nodes[node]) rep.nodes[node] = { score: 0 }
				rep.nodes[node].score = (Number(rep.nodes[node].score) || 0) - 5
			})
		return 'rejected'
	}
	await appendSharedOperation(username, cabinetId, operation)
	knownOperationIds.add(operation.operation_id)
	return 'accepted'
}
