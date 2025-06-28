/**
 * @fileoverview Endpoints for chat list operations.
 */

/**
 * Gets the list of chats.
 * @return {!Promise<!Array<string>>} A promise that resolves to an array of chat IDs.
 */
export async function getChatList() {
	const response = await fetch('/api/shells/chat/getchatlist')
	if (response.ok)
		return response.json()
	else {
		console.error('Failed to get chat list:', response.status, response.statusText)
		return []
	}
}

const char_details_cache = {}

/**
 * Gets character details.
 * @param {string} charname The name of the character.
 * @return {!Promise<!Object>} A promise that resolves to the character details.
 */
export async function getCharDetails(charname) {
	if (char_details_cache[charname])
		return char_details_cache[charname]


	const promise = fetch(`/api/getdetails/chars?name=${charname}`)
		.then(response => {
			if (response.ok)
				return response.json()
			else {
				console.error('Failed to get char details:', response.status, response.statusText)
				// Remove the promise from cache on error to allow retries.
				delete char_details_cache[charname]
				return {} // Or throw an error, depending on desired error handling.
			}
		})
		.catch(error => {
			console.error('Error fetching char details:', error)
			delete char_details_cache[charname]
			throw error // Re-throw the error to propagate it.
		})

	char_details_cache[charname] = promise
	return promise
}

/**
 * Copies chats.
 * @param {!Array<string>} chatids An array of chat IDs to copy.
 * @return {!Promise<!Object>} A promise that resolves to the server response.
 * @throws {Error} If the API request fails.
 */
export async function copyChats(chatids) {
	const response = await fetch('/api/shells/chat/copy', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }))

	return response.json()
}

/**
 * Deletes chats.
 * @param {!Array<string>} chatids An array of chat IDs to delete.
 * @return {!Promise<!Object>} A promise that resolves to the server response.
 * @throws {Error} If the API request fails.
 */
export async function deleteChats(chatids) {
	const response = await fetch('/api/shells/chat/delete', {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }))

	return response.json()
}

/**
 * Exports chats.
 * @param {!Array<string>} chatids An array of chat IDs to export.
 * @return {!Promise<!Object>} A promise that resolves to the server response.
 * @throws {Error} If the API request fails.
 */
export async function exportChats(chatids) {
	const response = await fetch('/api/shells/chat/export', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }))

	return response.json()
}
