/**
 * 使用 PBKDF2 从密钥派生 AES-256 密钥（CryptoJS WordArray）。
 * @param {string} secret 用于派生密钥的密钥（例如，fount UUID）。
 * @returns {Promise<import('crypto-js').WordArray>} 派生的密钥。
 */
import CryptoJS from 'https://esm.sh/crypto-js'

import { ping } from '../api/base.mjs'

import { downloadFromCatbox, uploadToCatbox } from './catbox.mjs'

/**
 * 获取用于加密/解密的密钥。
 * @param {string} secret - 密钥。
 * @returns {Promise<import('crypto-js').WordArray>} - AES-256 密钥。
 */
async function getKey(secret) {
	const salt = CryptoJS.enc.Utf8.parse('fount-credential-salt')
	const keySize = 256 / 32 // 256-bit key, 32-bit words
	const iterations = 100000

	return CryptoJS.PBKDF2(secret, salt, {
		keySize,
		iterations,
		hasher: CryptoJS.algo.SHA256
	})
}

/**
 * 使用 AES-256-CBC 加密纯文本字符串。
 * @param {string} plaintext 要加密的字符串。
 * @param {string} secret 用于密钥派生的密钥（UUID）。
 * @returns {Promise<string>} 包含 iv 和内容的 JSON 字符串。
 */
async function encrypt(plaintext, secret) {
	const key = await getKey(secret)
	const iv = CryptoJS.lib.WordArray.random(128 / 8) // 128-bit IV for AES

	const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
		iv,
		mode: CryptoJS.mode.CBC,
		padding: CryptoJS.pad.Pkcs7
	})

	return JSON.stringify({
		iv: CryptoJS.enc.Base64.stringify(iv),
		content: encrypted.toString()
	})
}

/**
 * 解密 AES-256-CBC 加密的有效负载。
 * @param {string} encryptedJson 包含 iv 和内容的 JSON 字符串。
 * @param {string} secret 用于加密的密钥（UUID）。
 * @returns {Promise<string>} 解密的纯文本。
 */
async function decrypt(encryptedJson, secret) {
	const key = await getKey(secret)
	const data = JSON.parse(encryptedJson)
	const iv = CryptoJS.enc.Base64.parse(data.iv)

	const decrypted = CryptoJS.AES.decrypt(data.content, key, {
		iv,
		mode: CryptoJS.mode.CBC,
		padding: CryptoJS.pad.Pkcs7
	})

	const plaintext = decrypted.toString(CryptoJS.enc.Utf8)
	if (!plaintext)
		throw new Error('Decryption resulted in empty or invalid plaintext.')

	return plaintext
}

/**
 * 从 fileId、剪贴板或 URL hash 加载加密凭据密文。
 * @param {string | null} fileId - Catbox 文件 ID。
 * @param {string | null} transitSource - hash 中的来源渠道（如 `'clipboard'`）。
 * @param {URLSearchParams} hashParams - 哈希参数。
 * @param {{ clipboardHashFallback?: boolean }} [options] - `clipboardHashFallback` 为 true 时，剪贴板读取失败回退到 hash。
 * @returns {Promise<string|null>} 密文字符串，或无可用的来源时 `null`。
 */
async function loadEncryptedCredentials(fileId, transitSource, hashParams, { clipboardHashFallback = false } = {}) {
	if (fileId)
		return downloadFromCatbox(fileId)

	if (transitSource === 'clipboard')
		try {
			const encryptedData = await navigator.clipboard.readText()
			if (encryptedData)
				return encryptedData
			throw new Error('Clipboard is empty.')
		}
		catch (error) {
			if (!clipboardHashFallback)
				throw error
			console.warn('Clipboard read failed, falling back to URL hash.', error)
			const encryptedFromHash = hashParams.get('encrypted_creds')
			if (encryptedFromHash)
				return decodeURIComponent(encryptedFromHash)
			throw error
		}

	const encryptedFromHash = hashParams.get('encrypted_creds')
	if (encryptedFromHash)
		return decodeURIComponent(encryptedFromHash)

	return null
}

/**
 * 将加密数据写入 hash 参数：剪贴板 → Catbox → URL hash。
 * @param {string} encryptedData 要传输的加密数据。
 * @param {URLSearchParams} hashParams 哈希参数对象，将被修改。
 * @param {{ tryClipboard?: boolean, clipboardSourceValue?: string }} [options] - 是否尝试剪贴板及成功时 hash `from` 的值。
 * @returns {Promise<'clipboard' | 'catbox' | 'hash'>} 实际使用的传输方式。
 */
async function applyCredentialTransitToHashParams(encryptedData, hashParams, {
	tryClipboard = false,
	clipboardSourceValue = 'clipboard',
} = {}) {
	if (tryClipboard)
		try {
			await navigator.clipboard.writeText(encryptedData)
			hashParams.set('from', clipboardSourceValue)
			return 'clipboard'
		}
		catch (error) {
			console.warn('Clipboard write failed, falling back to Catbox.', error)
		}

	try {
		const fileId = await uploadToCatbox(encryptedData, '1h', 'fount_creds.txt')
		hashParams.set('fileId', fileId)
		return 'catbox'
	}
	catch (error) {
		console.warn('Catbox upload failed, falling back to URL hash.', error)
		hashParams.set('encrypted_creds', encodeURIComponent(encryptedData))
		return 'hash'
	}
}

/**
 * 从源检索加密的凭据数据，通过尝试解密来验证它，如果有效则返回原始加密数据。
 * @param {string | null} fileId - 文件 ID。
 * @param {string | null} transitSource - 来源渠道（hash 中的 `from` 值）。
 * @param {URLSearchParams} hashParams - 哈希参数。
 * @param {string} uuid - UUID。
 * @returns {Promise<string>} 原始加密数据字符串。
 */
export async function receiveAndValidateEncryptedCredentials(fileId, transitSource, hashParams, uuid) {
	const encryptedData = await loadEncryptedCredentials(fileId, transitSource, hashParams)
	if (!encryptedData)
		throw new Error('No encrypted credentials found in transit.')
	if (!uuid)
		throw new Error('No UUID provided for validation.')

	const parsed = JSON.parse(encryptedData)
	if (!parsed.iv || !parsed.content)
		throw new Error('Invalid encrypted data format: missing iv or content fields.')

	await decrypt(encryptedData, uuid)
	return encryptedData
}

/**
 * 从源检索加密的凭据数据并解密。
 * @param {string | null} fileId - 文件 ID。
 * @param {string | null} transitSource - 来源渠道（hash 中的 `from` 值）。
 * @param {URLSearchParams} hashParams - 哈希参数。
 * @param {string} uuid - UUID。
 * @returns {Promise<string|null>} 解密的纯文本凭据（JSON 字符串），无密文时 `null`。
 */
export async function retrieveAndDecryptCredentials(fileId, transitSource, hashParams, uuid) {
	const encryptedData = await loadEncryptedCredentials(fileId, transitSource, hashParams, { clipboardHashFallback: true })
	if (!encryptedData)
		return null
	if (!uuid)
		throw new Error('No UUID provided for decryption.')

	return decrypt(encryptedData, uuid)
}

/**
 * 为加密数据执行传输策略并发起重定向。
 * 它会尝试剪贴板，然后是 Catbox。如果两者都失败，它会准备 URL 哈希参数，但不会重定向。
 * @param {string} encryptedData 要传输的加密数据。
 * @param {URL} targetUrl 目标 URL 对象，将被修改。
 * @param {URLSearchParams} hashParams 哈希参数对象，将被修改。
 * @param {string} [clipboardSourceValue='clipboard'] 剪贴板成功时 hash `from` 参数的值。
 * @returns {Promise<boolean>} 如果发起了重定向（剪贴板/Catbox），则返回 `true`；否则返回 `false`（哈希回退）。
 */
async function executeTransferStrategy(encryptedData, targetUrl, hashParams, clipboardSourceValue = 'clipboard') {
	const method = await applyCredentialTransitToHashParams(encryptedData, hashParams, {
		tryClipboard: true,
		clipboardSourceValue,
	})
	targetUrl.hash = hashParams.toString()
	if (method === 'hash')
		return false

	window.location.href = targetUrl.href
	return true
}

/**
 * 从 localStorage 加载纯文本凭据，对其进行加密，并通过将用户重定向到带有加密数据的目标 URL 来传输它们。
 * 传输通过剪贴板、Catbox 或 URL 哈希参数作为回退。
 * @param {string} uuid - 用户的唯一标识符。
 * @param {string} redirectUrl - 准备传输后要重定向到的 URL。
 * @returns {Promise<void>}
 */
export async function transferEncryptedCredentials(uuid, redirectUrl) {
	const instanceId = uuid.split('-')[0]
	const storedEncryptedData = localStorage.getItem(`fount-login-${instanceId}`)
	const targetUrl = new URL(decodeURIComponent(redirectUrl))
	const targetHashParams = new URLSearchParams(targetUrl.hash.substring(1))
	targetHashParams.set('uuid', uuid)
	targetUrl.hash = targetHashParams.toString()

	const redirected = await executeTransferStrategy(storedEncryptedData, targetUrl, targetHashParams)
	if (redirected)
		return

	targetUrl.hash = targetHashParams.toString()
	window.location.href = targetUrl.href
}

/**
 * 重定向到登录信息页面。
 * @param {string} [redirectUrl='/login'] - 重定向 URL。
 * @param {string|null} [username=null] - 用户名。
 * @param {string|null} [password=null] - 密码。
 * @returns {Promise<void>}
 */
export async function redirectToLoginInfo(redirectUrl = '/login', username = null, password = null) {
	if (redirectUrl.startsWith('/')) redirectUrl = window.location.origin + redirectUrl

	const { uuid } = await ping()
	if (!uuid) throw new Error('Could not fetch instance UUID.')

	const loginInfoUrl = new URL('https://steve02081504.github.io/fount/login_info/')
	loginInfoUrl.searchParams.set('redirect', encodeURIComponent(redirectUrl))

	const hashParams = new URLSearchParams()
	hashParams.set('uuid', uuid)

	if (username && password) {
		const credentials = { username, password }
		const encryptedData = await encrypt(JSON.stringify(credentials), uuid)

		loginInfoUrl.hash = hashParams.toString()

		const redirected = await executeTransferStrategy(encryptedData, loginInfoUrl, hashParams, 'clipboard')

		if (!redirected) {
			loginInfoUrl.hash = hashParams.toString()
			window.location.href = loginInfoUrl.href
		}
	}
	else {
		loginInfoUrl.hash = hashParams.toString()
		window.location.href = loginInfoUrl.href
	}
}

/**
 * 生成登录信息 URL。
 * @param {object} credentials - 凭据。
 * @param {string} uuid - UUID。
 * @param {string} baseUrl - 基本 URL。
 * @returns {Promise<string>} - 登录信息 URL。
 */
export async function generateLoginInfoUrl(credentials, uuid, baseUrl) {
	const redirectUrl = new URL(`${baseUrl}/login`)
	redirectUrl.searchParams.set('autologin', 'true')
	redirectUrl.searchParams.set('userPreferredLanguages', localStorage.getItem('userPreferredLanguages') || '[]')
	redirectUrl.searchParams.set('theme', localStorage.getItem('theme') || 'dark')

	const loginInfoUrl = new URL('https://steve02081504.github.io/fount/login_info/')
	loginInfoUrl.searchParams.set('redirect', encodeURIComponent(redirectUrl.href))
	loginInfoUrl.searchParams.set('forward', 'true')

	const encryptedData = await encrypt(JSON.stringify(credentials), uuid)
	const hashParams = new URLSearchParams()
	hashParams.set('uuid', uuid)

	await applyCredentialTransitToHashParams(encryptedData, hashParams)
	loginInfoUrl.hash = hashParams.toString()
	return loginInfoUrl.href
}
