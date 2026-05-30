/**
 * @param {string} name Log basename (`.log` appended).
 * @param {unknown} data Payload to append.
 * @returns {Promise<void>}
 */
export async function debugLog(name, data) {
	await fetch('/api/test/debug-log', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, data }),
	})
}
