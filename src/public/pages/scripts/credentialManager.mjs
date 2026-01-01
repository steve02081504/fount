/**
 * 使用 PBKDF2 从密钥派生一个 32 字节的密钥。
 * 这适用于 AES-GCM，可用于加密和解密。
 * @param {string} secret 用于派生密钥的密钥（例如，fount UUID）。
 * @returns {Promise<CryptoKey>} 派生的 CryptoKey。
 */
import CryptoJS from 'https://esm.sh/crypto-js'

/**
 * 获取用于加密/解密的密钥。
 * @param {string} secret - 密钥。
 * @returns {Promise<CryptoKey>} - 加密/解密密钥。
 */
async function getKey(secret) {
	const salt = CryptoJS.enc.Utf8.parse('fount-credential-salt')
	const keySize = 256 / 32 // 256-bit key, 32-bit words
	const iterations = 100000

	const key = CryptoJS.PBKDF2(secret, salt, {
		keySize,
		iterations,
		hasher: CryptoJS.algo.SHA256 // Use SHA256 as the hash algorithm
	})
	return key
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

	const result = {
		iv: CryptoJS.enc.Base64.stringify(iv),
		content: encrypted.toString()
	}

	return JSON.stringify(result)
}

/**
 * 解密 AES-256-CBC 加密的有效负载。
 * @param {string} encryptedJson 包含 iv 和内容的 JSON 字符串。
 * @param {string} secret 用于加密的密钥（UUID）。
 * @returns {Promise<string>} 解密的纯文本。
 */
async function decrypt(encryptedJson, secret) {
	try {
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
	catch (e) {
		console.error('Decryption failed:', e)
		throw new Error('Could not decrypt data. The data may be corrupt or the key incorrect.')
	}
}

const CATBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'

/**
 * 将文本上传到 Catbox/Litterbox 并返回文件 ID。
 * @param {string} content 要上传的文本内容。
 * @param {string} expiration 文件的过期时间（例如，“1h”、“24h”）。
 * @returns {Promise<string>} 文件 ID（即 catbox 上的文件名）。
 */
async function uploadToCatbox(content, expiration = '1h') {
	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', new Blob([content]), 'fount_creds.txt')

	const response = await fetch(CATBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to Catbox: ${await response.text()}`)


	const fileUrl = await response.text()
	// The response is the full URL, e.g., https://litter.catbox.moe/abcdef
	// The fileId is the part after the last slash.
	return new URL(fileUrl).pathname.substring(1)
}

/**
 * 从源检索加密的凭据数据，通过尝试解密来验证它，如果有效则返回原始加密数据。
 * @param {string | null} fileId - 文件 ID。
 * @param {string | null} from - 来源。
 * @param {URLSearchParams} hashParams - 哈希参数。
 * @param {string} uuid - UUID。
 * @returns {Promise<string|null>} 如果有效，则为原始加密数据字符串；否则为 null。
 */
export async function receiveAndValidateEncryptedCredentials(fileId, from, hashParams, uuid) {
	try {
		let encryptedData = null
		if (fileId) { // From Catbox link
			const resp = await fetch(`https://litter.catbox.moe/${fileId}`)
			if (resp.ok)
				encryptedData = await resp.text()
			else
				throw new Error(`Failed to fetch credentials from Catbox: ${resp.statusText}`)
		}
		else if (from === 'clipboard')
			encryptedData = await navigator.clipboard.readText()
		else {
			const encryptedFromHash = hashParams.get('encrypted_creds')
			if (encryptedFromHash)
				encryptedData = decodeURIComponent(encryptedFromHash)
		}

		if (!encryptedData)
			throw new Error('No encrypted credentials found in transit.')

		try {
			const parsed = JSON.parse(encryptedData)
			if (!parsed.iv || !parsed.content)
				throw new Error('Invalid encrypted data format: missing iv or content fields.')
		}
		catch (e) {
			throw new Error(`Invalid encrypted data format: not a valid JSON object. ${e.message}`)
		}

		if (!uuid)
			throw new Error('No UUID provided for validation.')

		// Validate the data by trying to decrypt it. This will throw if it fails.
		await decrypt(encryptedData, uuid)
		// If decryption succeeds, return the original encrypted data.
		return encryptedData
	}
	catch (e) {
		console.error('Encrypted data validation failed:', e)
		// Re-throw a new, more informative error to be caught by the caller.
		throw new Error(`Credential validation failed: ${e.message}`)
	}
}

/**
 * 从源检索加密的凭据数据并解密。
 * @param {string | null} fileId - 文件 ID。
 * @param {string | null} from - 来源。
 * @param {URLSearchParams} hashParams - 哈希参数。
 * @param {string} uuid - UUID。
 * @returns {Promise<string|null>} 解密的纯文本凭据（JSON 字符串）或 null。
 */
export async function retrieveAndDecryptCredentials(fileId, from, hashParams, uuid) {
	let encryptedData = null
	if (fileId) { // From Catbox link
		const resp = await fetch(`https://litter.catbox.moe/${fileId}`)
		if (!resp.ok) throw new Error(`Failed to fetch credentials from file: ${resp.statusText}`)
		encryptedData = await resp.text()
	}
	else if (from === 'clipboard')  // From login page (encrypted)
		try {
			encryptedData = await navigator.clipboard.readText()
			if (!encryptedData)
				throw new Error('Clipboard is empty.')
		}
		catch (e) {
			console.warn('Clipboard read failed, falling back to URL hash.', e)
			const encryptedFromHash = hashParams.get('encrypted_creds')
			if (encryptedFromHash)
				encryptedData = decodeURIComponent(encryptedFromHash)
		}

	else {
		const encryptedFromHash = hashParams.get('encrypted_creds')
		if (encryptedFromHash)
			encryptedData = decodeURIComponent(encryptedFromHash)
	}

	if (encryptedData && uuid)
		return decrypt(encryptedData, uuid)

	return null
}
/**
 * 为加密数据执行传输策略并发起重定向。
 * 它会尝试剪贴板，然后是 Catbox。如果两者都失败，它会准备 URL 哈希参数，但不会重定向。
 * @param {string} encryptedData 要传输的加密数据。
 * @param {URL} targetUrl 目标 URL 对象，将被修改。
 * @param {URLSearchParams} hashParams 哈希参数对象，将被修改。
 * @param {string} [clipboardFromValue='clipboard'] 剪贴板成功时"from"参数的值。
 * @returns {Promise<boolean>} 如果发起了重定向（剪贴板/Catbox），则返回 `true`；否则返回 `false`（哈希回退）。
 */
async function executeTransferStrategy(encryptedData, targetUrl, hashParams, clipboardFromValue = 'clipboard') {
	// 1. Try to use clipboard
	try {
		await navigator.clipboard.writeText(encryptedData)
		// Put 'from' in hash params for security (not sent to server)
		hashParams.set('from', clipboardFromValue)
		console.log('Encrypted credentials copied to clipboard for transfer.')
		targetUrl.hash = hashParams.toString()
		window.location.href = targetUrl.href
		return true // Redirect initiated
	}
	catch (e) {
		console.warn('Clipboard write failed, falling back to Catbox.', e)
	}

	// 2. Fallback to Catbox
	try {
		const fileId = await uploadToCatbox(encryptedData, '1h')
		// Put fileId in hash params for security (not sent to server)
		hashParams.set('fileId', fileId)
		console.log(`Encrypted credentials uploaded to Catbox for transfer with fileId: ${fileId}`)
		targetUrl.hash = hashParams.toString()
		window.location.href = targetUrl.href
		return true // Redirect initiated
	}
	catch (catboxErr) {
		console.warn('Catbox upload failed, falling back to URL hash.', catboxErr)
	}

	// 3. Fallback to URL hash
	hashParams.set('encrypted_creds', encodeURIComponent(encryptedData))
	return false // No redirect initiated, caller must handle it
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

	try {
		const targetHashParams = new URLSearchParams(targetUrl.hash.substring(1))
		targetHashParams.set('uuid', uuid) // Pass full UUID for decryption

		// Set hash before transfer, so clipboard/catbox redirects include it
		targetUrl.hash = targetHashParams.toString()

		const redirected = await executeTransferStrategy(storedEncryptedData, targetUrl, targetHashParams)
		if (redirected) return

		// For hash fallback, executeTransferStrategy has modified targetHashParams.
		// Re-set the hash to include the encrypted_creds.
		targetUrl.hash = targetHashParams.toString()
	}
	catch (transferErr) {
		console.error('Failed to transfer encrypted credentials:', transferErr)
		throw transferErr
	}

	// This redirect is for the hash fallback case.
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

	const { uuid } = await fetch('/api/ping', { credentials: 'omit' }).then(res => res.json())
	if (!uuid) throw new Error('Could not fetch instance UUID.')

	const loginInfoUrl = new URL('https://steve02081504.github.io/fount/login_info/')
	loginInfoUrl.searchParams.set('redirect', encodeURIComponent(redirectUrl))

	const hashParams = new URLSearchParams()
	hashParams.set('uuid', uuid)

	// If credentials are provided, use the secure transfer method
	if (username && password) {
		const credentials = { username, password }
		const encryptedData = await encrypt(JSON.stringify(credentials), uuid)

		loginInfoUrl.hash = hashParams.toString() // Set hash early, as all paths use it

		const redirected = await executeTransferStrategy(encryptedData, loginInfoUrl, hashParams, 'clipboard')

		if (!redirected) {
			// Hash fallback was used, so finalize the hash and redirect
			loginInfoUrl.hash = hashParams.toString()
			window.location.href = loginInfoUrl.href
		}
	}
	else {
		// No credentials, just redirect to login_info with uuid in hash
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

	try {
		const fileId = await uploadToCatbox(encryptedData, '1h')
		// Put fileId in hash params for security (not sent to server)
		hashParams.set('fileId', fileId)
	}
	catch (e) {
		console.warn('Catbox upload failed, falling back to URL hash.', e)
		hashParams.set('encrypted_creds', encodeURIComponent(encryptedData))
	}

	loginInfoUrl.hash = hashParams.toString()
	return loginInfoUrl.href
}
