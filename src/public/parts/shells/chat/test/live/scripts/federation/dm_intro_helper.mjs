/**
 * Emit signed DM intro link fields for fed_dm.ps1 (no HTTP signing endpoint).
 * Usage: deno run dm_intro_helper.mjs --data-path <root> --user <username>
 *
 * Lightweight: reads federation identity + dmIntro directly from disk (no server init).
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { dmLinkSignableBytes } from 'fount/public/parts/shells/chat/src/chat/lib/dmLinkSignature.mjs'
import { formatDmRunUri } from 'fount/public/parts/shells/chat/src/chat/lib/runUri.mjs'
import { loadJsonFileIfExists, saveJsonFile } from 'fount/scripts/json_loader.mjs'
import { sign } from 'fount/scripts/p2p/crypto.mjs'
import { HEX_ID_64, normalizeHex64 } from 'fount/scripts/p2p/hexIds.mjs'


const { values } = parseArgs({
	options: {
		'data-path': { type: 'string' },
		user: { type: 'string' },
	},
})

const dataPath = values['data-path']
const user = values.user
if (!dataPath || !user) {
	console.error('usage: --data-path <dir> --user <username>')
	process.exit(2)
}

/**
 * 解析用户数据目录（支持自定义 UserDictionary）。
 * @param {string} root data 根目录
 * @param {string} username 用户名
 * @returns {string} 用户数据目录
 */
function resolveUserDictionary(root, username) {
	const dataRoot = path.resolve(root)
	const config = loadJsonFileIfExists(path.join(dataRoot, 'config.json'), null)
	const custom = config?.data?.users?.[username]?.UserDictionary
	if (custom) return path.resolve(String(custom))
	return path.join(dataRoot, 'users', username)
}

/**
 * 从磁盘读取联邦活跃 operator 密钥对（operator.json）。
 * @param {string} userDir 用户目录
 * @returns {{ activePubKeyHex: string, secretHex: string }} 联邦活跃钥
 */
function loadFederationIdentity(userDir) {
	const operator = loadJsonFileIfExists(path.join(userDir, 'settings', 'operator.json'), {})
	const activePub = normalizeHex64(operator.activePubKeyHex)
	const activeSecret = normalizeHex64(operator.activeSecretKeyHex)
	if (HEX_ID_64.test(activePub) && activeSecret.length >= 64)
		return { activePubKeyHex: activePub, secretHex: activeSecret }
	throw new Error('operator active key missing')
}

/**
 * 读取或生成 dmIntro nonce。
 * @param {string} userDir 用户目录
 * @returns {string} base64url dmIntro nonce
 */
function loadOrCreateDmIntroNonce(userDir) {
	const dmIntroPath = path.join(userDir, 'shells', 'chat', 'dmIntro.json')
	const raw = loadJsonFileIfExists(dmIntroPath, {})
	const nonce = String(raw?.nonce || '').trim()
	if (nonce.length >= 16) return nonce
	const row = { nonce: randomBytes(32).toString('base64url'), rotatedAt: Date.now() }
	fs.mkdirSync(path.dirname(dmIntroPath), { recursive: true })
	saveJsonFile(dmIntroPath, row)
	return row.nonce
}

const userDir = resolveUserDictionary(dataPath, user)
const { activePubKeyHex, secretHex } = loadFederationIdentity(userDir)
if (!HEX_ID_64.test(activePubKeyHex) || secretHex.length < 64) {
	console.error('active operator secret missing for user', user)
	process.exit(1)
}

const nonce = loadOrCreateDmIntroNonce(userDir)
const secretKey32 = Buffer.from(secretHex, 'hex').subarray(0, 32)
const introSignatureHex = Buffer.from(
	await sign(dmLinkSignableBytes(activePubKeyHex, nonce), secretKey32),
).toString('hex')
const url = formatDmRunUri({
	pubKeyHex: activePubKeyHex,
	nonceBase64Url: nonce,
	introSignatureHex,
})

console.log(JSON.stringify({
	pubKeyHex: activePubKeyHex,
	dmIntroNonce: nonce,
	dmIntroSignatureHex: introSignatureHex,
	url,
}))
