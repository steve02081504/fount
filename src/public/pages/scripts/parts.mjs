/**
 * 部件相关的 API 函数。
 */

/**
 * 运行部件。
 * @param {string} partpath - 部件路径。
 * @param {object} args - 参数。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function runPart(partpath, args) {
	const response = await fetch('/api/runpart', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ partpath, args }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 加载部件。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function loadPart(partpath) {
	const response = await fetch('/api/loadpart', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ partpath }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取部件类型列表。
 * @returns {Promise<string[]>} - 部件类型列表。
 */
export async function getPartTypeList() {
	const response = await fetch('/api/getparttypelist')
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取部件列表。
 * @param {string} path - 路径。
 * @returns {Promise<object>} - 部件列表。
 */
export async function getPartList(path) {
	const response = await fetch(`/api/getlist/${path}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取已加载部件的列表。
 * @param {string} path - 路径。
 * @returns {Promise<object>} - 已加载的部件列表。
 */
export async function getLoadedPartList(path) {
	const response = await fetch(`/api/getloadedlist/${path}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取所有缓存的部件详细信息。
 * @param {string} path - 路径。
 * @returns {Promise<object>} - 缓存的部件详细信息。
 */
export async function getAllCachedPartDetails(path) {
	const response = await fetch(`/api/getallcacheddetails/${path}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取部件详细信息。
 * @param {string} path - 路径。
 * @param {boolean} [nocache=false] - 是否不使用缓存。
 * @returns {Promise<object>} - 部件详细信息。
 */
export async function getPartDetails(path, nocache = false) {
	const url = new URL(window.location.origin + `/api/getdetails/${path}`)
	if (nocache) url.searchParams.set('nocache', 'true')
	const response = await fetch(url)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取所有默认部件。
 * @returns {Promise<object>} - 默认部件。
 */
export async function getAllDefaultParts() {
	const response = await fetch('/api/defaultpart/getall')
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 设置默认部件。
 * @param {string} parent - 父部件。
 * @param {string} child - 子部件。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function setDefaultPart(parent, child) {
	const response = await fetch('/api/defaultpart/add', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ parent, child }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 取消设置默认部件。
 * @param {string} parent - 父部件。
 * @param {string} child - 子部件。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function unsetDefaultPart(parent, child) {
	const response = await fetch('/api/defaultpart/unset', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ parent, child }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取任何默认部件。
 * @param {string} parent - 父部件。
 * @returns {Promise<string>} - 默认子部件。
 */
export async function getAnyDefaultPart(parent) {
	const response = await fetch(`/api/defaultpart/getany/${parent}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 按类型获取所有默认部件。
 * @param {string} parent - 父部件。
 * @returns {Promise<object>} - 默认子部件列表。
 */
export async function getAllDefaultPartsByType(parent) {
	const response = await fetch(`/api/defaultpart/getallbytype/${parent}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取任何首选的默认部件。
 * @param {string} parent - 父部件。
 * @returns {Promise<string>} - 首选的默认子部件。
 */
export async function getAnyPreferredDefaultPart(parent) {
	const response = await fetch(`/api/defaultpart/getanypreferred/${parent}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取部件分支树。
 * @param {boolean} [nocache=false] - 是否绕过缓存。
 * @returns {Promise<object>} - 部件分支对象。
 */
export async function getPartBranches(nocache = false) {
	const url = new URL('/api/getpartbranches', window.location.origin)
	if (nocache) url.searchParams.set('nocache', 'true')
	return fetch(url).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	})
}


/**
 * 解锁成就。
 * @param {string} partpath - 部件路径。
 * @param {string} achievementId - 成就 ID。
 * @returns {Promise<Response>} - 服务器响应。
 */
export function unlockAchievement(partpath, achievementId) {
	return fetch('/api/parts/shells:achievements/unlock', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ partpath, id: achievementId }),
	}).catch(() => { /* Fail silently */ })
}
