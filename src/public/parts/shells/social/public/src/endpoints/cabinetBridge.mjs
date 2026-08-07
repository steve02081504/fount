/** Social 借用的 Cabinet shell HTTP 面：远端实体的共享柜列表。 */

/**
 * @param {string} entityHash 实体
 * @returns {Promise<{ cabinets: object[] }>} 该实体可见的共享柜
 */
export async function listRemoteCabinets(entityHash) {
	const response = await fetch(`/api/parts/shells:cabinet/remote/${encodeURIComponent(entityHash)}/cabinets`, {
		credentials: 'include',
	})
	if (!response.ok) throw new Error(await response.text())
	return response.json()
}
