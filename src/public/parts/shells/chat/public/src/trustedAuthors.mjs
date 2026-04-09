const DB_NAME = 'fount_chat_security'
const STORE = 'trustedAuthors'
const DB_VER = 1

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
	return new Promise((resolve, reject) => {
		const r = indexedDB.open(DB_NAME, DB_VER)
		r.onerror = () => reject(r.error)
		r.onupgradeneeded = () => {
			const db = r.result
			if (!db.objectStoreNames.contains(STORE))
				db.createObjectStore(STORE, { keyPath: 'h' })
		}
		r.onsuccess = () => resolve(r.result)
	})
}

/**
 * @param {string} pubKeyHash
 * @returns {Promise<boolean>}
 */
export async function isTrustedAuthor(pubKeyHash) {
	if (!pubKeyHash) return false
	const db = await openDb()
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly')
		const q = tx.objectStore(STORE).get(String(pubKeyHash))
		q.onsuccess = () => resolve(!!q.result)
		q.onerror = () => reject(q.error)
	})
}

/**
 * @param {string} pubKeyHash
 */
export async function trustAuthor(pubKeyHash) {
	if (!pubKeyHash) return
	const db = await openDb()
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite')
		tx.objectStore(STORE).put({ h: String(pubKeyHash), t: Date.now() })
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
	})
}
