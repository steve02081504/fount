/**
 * 解析 `#settings:<groupId>[:<section>]` hash 的各段（与 hub `urlHash` 一致支持 encode）。
 * @returns {{ groupIdRaw: string, section: string | null } | null} hash 不匹配时为 null
 */
function parseSettingsHashParts() {
	const hash = window.location.hash.slice(1)
	if (!hash.startsWith('settings:')) return null
	const [groupIdRaw, section] = hash.slice('settings:'.length).split(':')
	return { groupIdRaw, section: section || null }
}

/**
 * 从 `#settings:<groupId>[:<section>]` 解析群组 ID。
 * @returns {string | null} 群组 ID；hash 不匹配时为 null
 */
export function parseSettingsGroupIdFromHash() {
	const parts = parseSettingsHashParts()
	if (!parts) return null
	try {
		return decodeURIComponent(parts.groupIdRaw)
	}
	catch {
		return parts.groupIdRaw
	}
}

/**
 * 从 `#settings:<groupId>[:<section>]` 解析当前分区 id。
 * @returns {string | null} 分区 id；hash 不匹配或无分区时为 null
 */
export function parseSettingsSectionFromHash() {
	return parseSettingsHashParts()?.section ?? null
}

/**
 * 将当前分区 id 写回 hash，使刷新后保持选择（不新增历史记录）。
 * @param {string | null} section 分区 id；null 表示移除分区后缀
 * @returns {void}
 */
export function updateSettingsHashSection(section) {
	const parts = parseSettingsHashParts()
	if (!parts) return
	let groupId
	try {
		groupId = decodeURIComponent(parts.groupIdRaw)
	}
	catch {
		groupId = parts.groupIdRaw
	}
	const hash = section
		? `settings:${encodeURIComponent(groupId)}:${section}`
		: `settings:${encodeURIComponent(groupId)}`
	history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${hash}`)
}

/**
 * 格式化归档文件字节数为可读字符串。
 * @param {number} bytes 字节数
 * @returns {string} 可读大小
 */
export function formatArchiveBytes(bytes) {
	const n = Number(bytes) || 0
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
