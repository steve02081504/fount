/**
 * Emit signed DM intro link fields for fed_dm.mjs (no HTTP signing endpoint).
 * Usage: deno run dm_intro_helper.mjs --data-path <root> --user <username>
 *
 * Lightweight: reads federation identity + dmIntro directly from disk (no server init).
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { dmLinkSignableBytes } from 'fount/public/parts/shells/chat/public/shared/dmLinkSignature.mjs'
import { formatDmRunUri } from 'fount/public/parts/shells/chat/public/shared/runUri.mjs'
import { loadJsonFileIfExists, saveJsonFile } from 'fount/scripts/json_loader.mjs'
import { parseArgsOrExit } from 'fount/scripts/test/core/parse_args_or_exit.mjs'
import { HEX_ID_64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { sign } from 'npm:@steve02081504/fount-p2p/crypto'


const { values } = parseArgsOrExit({
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
 * 从磁盘读取 operator 活跃密钥对（entities 下 identity.json）。
 * @param {string} userDir 用户目录
 * @returns {{ activePubKeyHex: string, secretHex: string }} 联邦活跃钥
 */
function loadFederationIdentity(userDir) {
	const entitiesDir = path.join(userDir, 'entities')
	if (!fs.existsSync(entitiesDir)) throw new Error('operator identity missing')
	for (const name of fs.readdirSync(entitiesDir)) {
		const row = loadJsonFileIfExists(path.join(entitiesDir, name, 'identity.json'), null)
		if (!row || row.charPartName) continue
		const activePub = normalizeHex64(row.activePubKeyHex)
		const activeSecret = normalizeHex64(row.activeSecretKeyHex)
		if (HEX_ID_64.test(activePub) && activeSecret.length >= 64)
			return { activePubKeyHex: activePub, secretHex: activeSecret }
	}
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
