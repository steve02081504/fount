import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pubKeyHash, publicKeyFromSeed, sign, verify } from 'npm:@steve02081504/fount-p2p/crypto'
import { signPayloadBytes } from 'npm:@steve02081504/fount-p2p/dag/index'
import { appendJsonlSynced, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { isPubKeyHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, isSignatureHex128, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { wrapSocialRpc } from '../federation/part_wire_rpc.mjs'
import { sendToNode } from 'npm:@steve02081504/fount-p2p/trust_graph/send'
import { getUserDictionary } from '../../../../../../server/auth/index.mjs'
import { getOperatorSecretKey } from '../../../../../../server/p2p_server/operator_identity.mjs'

const REPORT_CATEGORIES = new Set(['spam', 'abuse', 'illegal', 'other'])
const MAX_REASON_LEN = 500
const MAX_CATEGORY_LEN = 32
const MAX_REPORT_BYTES = 4096

/**
 * @param {string} username replica
 * @returns {string} governance 目录
 */
function governanceDir(username) {
	return join(getUserDictionary(username), 'shells', 'social', 'governance')
}

/**
 * @param {string} username replica
 * @returns {string} 收到的举报队列
 */
export function governanceReportsPath(username) {
	return join(governanceDir(username), 'reports.jsonl')
}

/**
 * @param {string} username replica
 * @returns {string} 发出的举报审计
 */
export function governanceReportsSentPath(username) {
	return join(governanceDir(username), 'reports_sent.jsonl')
}

/**
 * @param {object} body 举报体
 * @returns {object} 规范化举报
 */
function normalizeReportBody(body) {
	const targetEntityHash = String(body.targetEntityHash || '').trim().toLowerCase()
	const targetPostId = body.targetPostId ? String(body.targetPostId).trim().toLowerCase() : null
	const reason = String(body.reason || '').trim().slice(0, MAX_REASON_LEN)
	const category = String(body.category || 'other').trim().toLowerCase().slice(0, MAX_CATEGORY_LEN)
	const reporterEntityHash = String(body.reporterEntityHash || '').trim().toLowerCase()
	const reporterPubKeyHash = normalizeHex64(body.reporterPubKeyHash || '')
	const reporterPubKeyHex = String(body.reporterPubKeyHex || '').trim().toLowerCase()
	const at = Number(body.at) || Date.now()
	if (!parseEntityHash(targetEntityHash)) throw new Error('invalid targetEntityHash')
	if (!parseEntityHash(reporterEntityHash)) throw new Error('invalid reporterEntityHash')
	if (!REPORT_CATEGORIES.has(category)) throw new Error('invalid category')
	if (reason.length < 2) throw new Error('reason too short')
	if (targetPostId && !isHex64(targetPostId)) throw new Error('invalid targetPostId')
	if (!isHex64(reporterPubKeyHash)) throw new Error('invalid reporterPubKeyHash')
	if (!isHex64(reporterPubKeyHex)) throw new Error('invalid reporterPubKeyHex')
	if (pubKeyHash(new Uint8Array(Buffer.from(reporterPubKeyHex, 'hex'))) !== reporterPubKeyHash)
		throw new Error('reporter pubkey mismatch')
	return {
		targetEntityHash,
		targetPostId,
		reason,
		category,
		reporterEntityHash,
		reporterPubKeyHash,
		reporterPubKeyHex,
		at,
	}
}

/**
 * @param {object} report 规范化举报
 * @returns {object} 签名体
 */
function reportSignBody(report) {
	return {
		targetEntityHash: report.targetEntityHash,
		targetPostId: report.targetPostId,
		reason: report.reason,
		category: report.category,
		reporterEntityHash: report.reporterEntityHash,
		reporterPubKeyHash: report.reporterPubKeyHash,
		reporterPubKeyHex: report.reporterPubKeyHex,
		at: report.at,
	}
}

/**
 * @param {string} username replica
 * @param {object} input 举报输入
 * @returns {Promise<object>} 已签名举报
 */
export async function signLocalReport(username, input) {
	const secretHex = await getOperatorSecretKey(username)
	if (!secretHex || secretHex.length !== 64) throw new Error('configure federation identity before reporting')
	const secretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))
	const reporterPubKeyHex = Buffer.from(publicKeyFromSeed(secretKey)).toString('hex')
	const reporterPubKeyHash = pubKeyHash(publicKeyFromSeed(secretKey))
	const report = normalizeReportBody({ ...input, reporterPubKeyHash, reporterPubKeyHex })
	const body = reportSignBody(report)
	const signatureBytes = await sign(signPayloadBytes(body), secretKey)
	const signature = Buffer.from(signatureBytes).toString('hex')
	return { ...report, signature }
}

/**
 * @param {object} report 带 signature 的举报
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyReportSignature(report) {
	const signatureHex = String(report?.signature || '').trim()
	if (!isSignatureHex128(signatureHex)) return false
	const pubKeyHex = String(report.reporterPubKeyHex || '').trim().toLowerCase()
	if (!isHex64(pubKeyHex)) return false
	const publicKeyBytes = new Uint8Array(Buffer.from(pubKeyHex, 'hex'))
	if (pubKeyHash(publicKeyBytes) !== String(report.reporterPubKeyHash || '').trim().toLowerCase()) return false
	const body = reportSignBody(report)
	const signatureBytes = new Uint8Array(Buffer.from(signatureHex, 'hex'))
	return verify(signatureBytes, signPayloadBytes(body), publicKeyBytes)
}

/**
 * @param {unknown} report 入站举报
 * @returns {Promise<object | null>} 清扫后举报；无效返回 null
 */
export async function sanitizeInboundReport(report) {
	try {
		const raw = JSON.stringify(report)
		if (raw.length > MAX_REPORT_BYTES) return null
		const normalized = normalizeReportBody(report)
		if (isPubKeyHashBlocked(normalized.reporterPubKeyHash)) return null
		if (!await verifyReportSignature({ ...normalized, signature: report.signature })) return null
		return { ...normalized, signature: String(report.signature) }
	}
	catch {
		return null
	}
}

/**
 * @param {string} username replica
 * @param {object} report 已签名举报
 * @returns {Promise<void>}
 */
export async function appendSentReportAudit(username, report) {
	await mkdir(governanceDir(username), { recursive: true })
	await appendJsonlSynced(governanceReportsSentPath(username), report)
}

/**
 * @param {string} username owner replica
 * @param {object} report 已签名举报
 * @returns {Promise<void>}
 */
export async function appendReceivedReport(username, report) {
	await mkdir(governanceDir(username), { recursive: true })
	await appendJsonlSynced(governanceReportsPath(username), report)
}

/**
 * @param {string} username replica
 * @param {object} input 举报输入
 * @returns {Promise<object>} 落盘后的举报
 */
export async function submitReport(username, input) {
	const signed = await signLocalReport(username, input)
	await appendSentReportAudit(username, signed)
	const targetNode = parseEntityHash(signed.targetEntityHash)?.nodeHash
	if (targetNode) 
		await sendToNode(username, targetNode, 'part_invoke', {
			partpath: getShellPartpath('social'),
			...wrapSocialRpc({ type: 'social_report', report: signed }),
		})
	
	return signed
}

/**
 * @param {string} username replica
 * @param {object} report 入站举报
 * @returns {Promise<boolean>} 是否入队
 */
export async function ingestInboundReport(username, report) {
	const cleaned = await sanitizeInboundReport(report)
	if (!cleaned) return false
	await appendReceivedReport(username, cleaned)
	return true
}

/**
 * @param {string} username replica
 * @param {{ limit?: number }} [options] 分页
 * @returns {Promise<{ reports: object[] }>} 本机收到的举报列表
 */
export async function listReceivedReports(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
	const rows = await readJsonl(governanceReportsPath(username))
	return { reports: rows.slice(-limit).reverse() }
}
