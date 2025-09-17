/**
 * Derives a 32-byte key from a secret using PBKDF2.
 * This is for AES-GCM and can be used for both encryption and decryption.
 * @param {string} secret The secret to derive the key from (e.g., fount UUID).
 * @returns {Promise<CryptoKey>} The derived CryptoKey.
 */
import CryptoJS from 'https://esm.sh/crypto-js'

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
 * Encrypts a plaintext string using AES-256-CBC.
 * @param {string} plaintext The string to encrypt.
 * @param {string} secret The secret (UUID) to use for key derivation.
 * @returns {Promise<string>} A JSON string containing the iv and content.
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
 * Decrypts an AES-256-CBC encrypted payload.
 * @param {string} encryptedJson A JSON string containing iv and content.
 * @param {string} secret The secret (UUID) used for encryption.
 * @returns {Promise<string>} The decrypted plaintext.
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
 * Uploads text to Catbox/Litterbox and returns the file ID.
 * @param {string} content The text content to upload.
 * @param {string} expiration The expiration time for the file (e.g., '1h', '24h').
 * @returns {Promise<string>} The file ID (which is the filename on catbox).
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
 * Retrieves encrypted credential data from a source, validates it by attempting decryption,
 * and returns the raw encrypted data if valid.
 * @param {string | null} fileId
 * @param {string | null} from
 * @param {URLSearchParams} hashParams
 * @param {string} uuid
 * @returns {Promise<string|null>} The raw encrypted data as a string if valid, otherwise null.
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
 * Retrieves encrypted credential data from a source and decrypts it.
 * @param {string | null} fileId
 * @param {string | null} from
 * @param {URLSearchParams} hashParams
 * @param {string} uuid
 * @returns {Promise<string|null>} The decrypted plaintext credentials as a JSON string, or null.
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
 * Executes a transfer strategy for encrypted data and initiates a redirect.
 * It tries Clipboard, then Catbox. If both fail, it prepares URL hash parameters
 * but does not redirect.
 * @param {string} encryptedData The encrypted data to transfer.
 * @param {URL} targetUrl The target URL object, which will be modified.
 * @param {URLSearchParams} hashParams The hash parameters object, which will be modified.
 * @param {string} [clipboardFromValue='clipboard'] The value for the 'from' search param on clipboard success.
 * @returns {Promise<boolean>} Returns `true` if a redirect was initiated (Clipboard/Catbox), `false` otherwise (Hash fallback).
 */
async function executeTransferStrategy(encryptedData, targetUrl, hashParams, clipboardFromValue = 'clipboard') {
	// 1. Try to use clipboard
	try {
		await navigator.clipboard.writeText(encryptedData)
		targetUrl.searchParams.set('from', clipboardFromValue)
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
		targetUrl.searchParams.set('fileId', fileId)
		console.log(`Encrypted credentials uploaded to Catbox for transfer with fileId: ${fileId}`)
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
 * Loads plaintext credentials from localStorage, encrypts them, and transfers them
 * by redirecting the user to a target URL with the encrypted data.
 * The transfer happens via clipboard, Catbox, or URL hash parameter as fallbacks.
 * @param {string} uuid - The user's unique identifier.
 * @param {string} redirectUrl - The URL to redirect to after preparing the transfer.
 */
export async function transferEncryptedCredentials(uuid, redirectUrl) {
	const instanceId = uuid.split('-')[0]
	const storedEncryptedData = localStorage.getItem(`fount-login-${instanceId}`)
	const targetUrl = new URL(decodeURIComponent(redirectUrl))

	if (!storedEncryptedData)
		throw new Error('No stored credentials found for this instance.')

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


export async function redirectToLoginInfo(redirectUrl = '/login', username = null, password = null) {
	if (redirectUrl.startsWith('/')) redirectUrl = window.location.origin + redirectUrl

	const { uuid } = await fetch('/api/ping').then(res => res.json())
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

export async function generateLoginInfoUrl(credentials, uuid, baseUrl) {
	const redirectUrl = new URL(`${baseUrl}/login`)
	redirectUrl.searchParams.set('autologin', 'true')
	redirectUrl.searchParams.set('userPreferredLanguages', localStorage.getItem('userPreferredLanguages') || '[]')
	redirectUrl.searchParams.set('theme', localStorage.getItem('theme') || 'dark')

	const loginInfoUrl = new URL('https://steve02081504.github.io/fount/login_info/')
	loginInfoUrl.searchParams.set('redirect', encodeURIComponent(redirectUrl.href))

	const encryptedData = await encrypt(JSON.stringify(credentials), uuid)
	const hashParams = new URLSearchParams()
	hashParams.set('uuid', uuid)

	try {
		const fileId = await uploadToCatbox(encryptedData, '1h')
		loginInfoUrl.searchParams.set('fileId', fileId)
	} catch (e) {
		console.warn('Catbox upload failed, falling back to URL hash.', e)
		hashParams.set('encrypted_creds', encodeURIComponent(encryptedData))
	}

	loginInfoUrl.hash = hashParams.toString()
	return loginInfoUrl.href
}
