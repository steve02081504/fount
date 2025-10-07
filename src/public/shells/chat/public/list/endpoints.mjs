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

import { getCharDetails as getCharDetails_real } from '../../../../scripts/parts.mjs'

const char_details_cache = {}

/**
 * Gets character details.
 * @param {string} charname The name of the character.
 * @return {!Promise<!Object>} A promise that resolves to the character details.
 */
export async function getCharDetails(charname) {
	if (char_details_cache[charname])
		return char_details_cache[charname]


	const promise = getCharDetails_real(charname)
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
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

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
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

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
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}
