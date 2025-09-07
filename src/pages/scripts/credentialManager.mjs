/**
 * Derives a 32-byte key from a secret using PBKDF2.
 * This is for AES-GCM and can be used for both encryption and decryption.
 * @param {string} secret The secret to derive the key from (e.g., fount UUID).
 * @returns {Promise<CryptoKey>} The derived CryptoKey.
 */
async function getKey(secret) {
	const keyMaterial = await window.crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'PBKDF2' },
		false,
		['deriveKey'],
	)
	return window.crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: new TextEncoder().encode('fount-credential-salt'),
			iterations: 100000,
			hash: 'SHA-256',
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt'], // Key usable for both operations
	)
}

/**
 * Converts a hex string to a Uint8Array buffer.
 * @param {string} hex The hex string.
 * @returns {Uint8Array}
 */
function hexToBuffer(hex) {
	const buffer = new Uint8Array(hex.length / 2)
	for (let i = 0; i < hex.length; i += 2)
		buffer[i / 2] = parseInt(hex.substr(i, 2), 16)

	return buffer
}

/**
 * Converts an ArrayBuffer to a hex string.
 * @param {ArrayBuffer} buffer The buffer to convert.
 * @returns {string}
 */
function bufferToHex(buffer) {
	return [...new Uint8Array(buffer)]
		.map(b => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param {string} plaintext The string to encrypt.
 * @param {string} secret The secret (UUID) to use for key derivation.
 * @returns {Promise<string>} A JSON string containing iv, content, and authTag.
 */
async function encrypt(plaintext, secret) {
	const key = await getKey(secret)
	const iv = window.crypto.getRandomValues(new Uint8Array(12)) // 96 bits is recommended for GCM

	const encryptedBuffer = await window.crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv,
		},
		key,
		new TextEncoder().encode(plaintext),
	)

	// The authTag is appended to the encrypted buffer by subtle.encrypt
	const contentBuffer = encryptedBuffer.slice(0, encryptedBuffer.byteLength - 16)
	const authTagBuffer = encryptedBuffer.slice(encryptedBuffer.byteLength - 16)

	return JSON.stringify({
		iv: bufferToHex(iv),
		content: bufferToHex(contentBuffer),
		authTag: bufferToHex(authTagBuffer),
	})
}


/**
 * Decrypts an AES-256-GCM encrypted payload.
 * @param {string} encryptedJson A JSON string containing iv, content, and authTag.
 * @param {string} secret The secret (UUID) used for encryption.
 * @returns {Promise<string>} The decrypted plaintext.
 */
async function decrypt(encryptedJson, secret) {
	try {
		const { iv, content, authTag } = JSON.parse(encryptedJson)
		const cryptoKey = await getKey(secret)
		const ivBuffer = hexToBuffer(iv)
		const dataBuffer = hexToBuffer(content)
		const authTagBuffer = hexToBuffer(authTag)

		// Combine content and authTag for decryption
		const fullBuffer = new Uint8Array(dataBuffer.length + authTagBuffer.length)
		fullBuffer.set(dataBuffer, 0)
		fullBuffer.set(authTagBuffer, dataBuffer.length)

		const decrypted = await window.crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: ivBuffer },
			cryptoKey,
			fullBuffer,
		)

		return new TextDecoder().decode(decrypted)
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
	let encryptedData = null
	try {
		if (fileId) { // From Catbox link
			const resp = await fetch(`https://litter.catbox.moe/${fileId}`)
			if (resp.ok)
				encryptedData = await resp.text()
		}
		else if (from === 'clipboard' || from === 'clipboard_encrypted') { // From login page (encrypted)
			encryptedData = await navigator.clipboard.readText()
		}
		else {
			const encryptedFromHash = hashParams.get('encrypted_creds')
			if (encryptedFromHash)
				encryptedData = decodeURIComponent(encryptedFromHash)
		}

		if (encryptedData && uuid) {
			// Validate the data by trying to decrypt it. This will throw if it fails.
			await decrypt(encryptedData, uuid)
			// If decryption succeeds, return the original encrypted data.
			return encryptedData
		}
	}
	catch (e) {
		console.error('Encrypted data validation failed:', e)
		return null // Return null if any part of the process fails
	}
	return null
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
		encryptedData = await navigator.clipboard.readText()

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

	if (storedEncryptedData)
		try {
			const targetHashParams = new URLSearchParams(targetUrl.hash.substring(1))
			targetHashParams.set('uuid', uuid) // Pass full UUID for decryption

			const redirected = await executeTransferStrategy(storedEncryptedData, targetUrl, targetHashParams)

			if (redirected)
				return // Redirect was handled by the strategy function

			// If not redirected, it means the hash fallback was used.
			targetUrl.hash = targetHashParams.toString()
		}
		catch (transferErr) {
			console.error('Failed to transfer encrypted credentials:', transferErr)
			// If transfer fails, we cannot proceed securely. Redirect without credentials.
		}

	// If no stored data or if an error occurred, redirect without credentials.
	window.location.href = targetUrl.href
}


export async function redirectToLoginInfo(redirectUrl = '/login', username = null, password = null) {
	if (redirectUrl.startsWith('/')) redirectUrl = window.location.origin + redirectUrl

	try {
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

			const redirected = await executeTransferStrategy(encryptedData, loginInfoUrl, hashParams, 'clipboard_encrypted')

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
	catch (e) {
		console.error('Could not fetch instance UUID for login_info redirect', e)
		// Fallback to direct redirect on error
	}
	// Fallback to direct redirect on error or if the page navigation takes too long.
	setTimeout(() => window.location.href = redirectUrl, 3000)
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
