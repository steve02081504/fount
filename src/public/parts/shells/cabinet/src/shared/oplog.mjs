import { appendFile, mkdir, readFile } from 'node:fs/promises'

import { mutateReputation } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { sharedCabinetOpsPath } from '../paths.mjs'

import { verifyOp } from './crypto.mjs'

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<object[]>} ops
 */
export async function loadSharedOps(username, cabinetId) {
	try {
		const text = await readFile(sharedCabinetOpsPath(username, cabinetId), 'utf8')
		return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
	}
	catch {
		return []
	}
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object} op 已签名 op
 * @returns {Promise<void>}
 */
export async function appendSharedOp(username, cabinetId, op) {
	const path = sharedCabinetOpsPath(username, cabinetId)
	await mkdir(path.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
	await appendFile(path, `${JSON.stringify(op)}\n`, 'utf8')
}

/**
 * 接收远端/本地 op：验签通过则追加（幂等按 op_id）。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object} op op
 * @param {Uint8Array | string} writePublicKey 写公钥
 * @param {{ peerNodeHash?: string }} [opts] 选项
 * @returns {Promise<'accepted' | 'duplicate' | 'rejected'>} 结果
 */
export async function ingestSharedOp(username, cabinetId, op, writePublicKey, opts = {}) {
	const ops = await loadSharedOps(username, cabinetId)
	if (ops.some(row => row.op_id === op.op_id)) return 'duplicate'
	const ok = await verifyOp(op, writePublicKey)
	if (!ok) {
		if (opts.peerNodeHash)
			mutateReputation(rep => {
				const node = String(opts.peerNodeHash)
				if (!rep.nodes) rep.nodes = {}
				if (!rep.nodes[node]) rep.nodes[node] = { score: 0 }
				rep.nodes[node].score = (Number(rep.nodes[node].score) || 0) - 5
			})
		return 'rejected'
	}
	await appendSharedOp(username, cabinetId, op)
	return 'accepted'
}
