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
export async function encrypt(plaintext, secret) {
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
export async function decrypt(encryptedJson, secret) {
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
