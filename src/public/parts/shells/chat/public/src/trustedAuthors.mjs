const DB_NAME = 'fount_chat_security'
const STORE = 'trustedAuthors'
const DB_VER = 1

/**
 * 打开或创建 IndexedDB 数据库（可信作者公钥哈希存储）。
 * @returns {Promise<IDBDatabase>} 就绪的数据库连接
 */
function openDb() {
	return new Promise((resolve, reject) => {
		const r = indexedDB.open(DB_NAME, DB_VER)
		/**
		 * 打开失败时拒绝 Promise。
		 * @returns {void}
		 */
		r.onerror = () => reject(r.error)
		/**
		 * 首次或升级版本时创建对象仓库。
		 * @returns {void}
		 */
		r.onupgradeneeded = () => {
			const db = r.result
			if (!db.objectStoreNames.contains(STORE))
				db.createObjectStore(STORE, { keyPath: 'h' })
		}
		/**
		 * 打开成功后解析数据库实例。
		 * @returns {void}
		 */
		r.onsuccess = () => resolve(r.result)
	})
}

/**
 * 查询公钥哈希是否已被用户标记为可信作者。
 * @param {string} pubKeyHash 作者公钥的哈希（十六进制或存储键）
 * @returns {Promise<boolean>} 若已信任则为 true
 */
export async function isTrustedAuthor(pubKeyHash) {
	if (!pubKeyHash) return false
	const db = await openDb()
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly')
		const q = tx.objectStore(STORE).get(String(pubKeyHash))
		/**
		 * 读取完成时解析是否存在记录。
		 * @returns {void}
		 */
		q.onsuccess = () => resolve(!!q.result)
		/**
		 * 读取失败时拒绝 Promise。
		 * @returns {void}
		 */
		q.onerror = () => reject(q.error)
	})
}

/**
 * 将公钥哈希写入可信作者表。
 * @param {string} pubKeyHash 作者公钥哈希
 * @returns {Promise<void>} 写入完成
 */
export async function trustAuthor(pubKeyHash) {
	if (!pubKeyHash) return
	const db = await openDb()
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite')
		tx.objectStore(STORE).put({ h: String(pubKeyHash), t: Date.now() })
		/**
		 * 事务成功提交后结束 Promise。
		 * @returns {void}
		 */
		tx.oncomplete = () => resolve()
		/**
		 * 事务失败时拒绝 Promise。
		 * @returns {void}
		 */
		tx.onerror = () => reject(tx.error)
	})
}
