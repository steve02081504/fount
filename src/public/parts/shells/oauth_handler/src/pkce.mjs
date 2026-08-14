import { createHash, randomBytes } from 'node:crypto'

/**
 * 将字节编码为 base64url（无填充）。
 * @param {Buffer} buffer - 原始字节。
 * @returns {string} base64url 字符串。
 */
export function base64url(buffer) {
	return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * 生成 PKCE verifier / S256 challenge。
 * @returns {{ verifier: string, challenge: string }} PKCE 对。
 */
export function generatePKCE() {
	const verifier = base64url(randomBytes(32))
	const challenge = base64url(createHash('sha256').update(verifier).digest())
	return { verifier, challenge }
}

/**
 * 生成 OAuth state。
 * @returns {string} 十六进制 state。
 */
export function randomState() {
	return randomBytes(16).toString('hex')
}
