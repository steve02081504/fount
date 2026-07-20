/**
 * 群设置中的帖子归档/热区参数解析。
 */

/**
 * @param {object} [groupSettings] 物化群设置
 * @returns {{
 *   hotLatest: number,
 *   pinContext: number,
 *   dagFoldAfterArchive: boolean,
 *   autoPruneMessagesJsonl: boolean,
 *   autoPruneDagMessages: boolean,
 * }} 归档相关群设置
 */
export function archiveSettingsFromGroup(groupSettings = {}) {
	return {
		hotLatest: Math.max(0, Number(groupSettings.hotLatestMessageCount) || 50),
		pinContext: Math.max(0, Number(groupSettings.pinContextMessageCount) || 30),
		dagFoldAfterArchive: groupSettings.dagFoldAfterArchive !== false,
		autoPruneMessagesJsonl: groupSettings.autoPruneMessagesJsonl === true,
		autoPruneDagMessages: groupSettings.autoPruneDagMessages === true,
	}
}

/** 归档分桶允许的 wall 与本地时钟最大偏差（约 1 个自然月） */
export const ARCHIVE_MONTH_WALL_MAX_SKEW_MS = 32 * 24 * 60 * 60 * 1000

/**
 * 将不可信 HLC wall 钳制到可信窗口，防止恶意分桶碎片化。
 * @param {number} wallMs HLC wall 毫秒
 * @returns {number} 钳制后的毫秒
 */
export function clampArchiveWallMs(wallMs) {
	const now = Date.now()
	const w = Number(wallMs)
	if (!Number.isFinite(w)) return now
	const min = now - ARCHIVE_MONTH_WALL_MAX_SKEW_MS
	const max = now + ARCHIVE_MONTH_WALL_MAX_SKEW_MS
	return Math.min(max, Math.max(min, w))
}

/**
 * 不可信入站 wall 是否超出本地时钟 ±1 月（防恶意分桶）。
 * @param {number} wallMs HLC wall 毫秒
 * @returns {boolean} true 表示应拒收
 */
export function isArchiveWallOutOfSkew(wallMs) {
	const w = Number(wallMs)
	if (!Number.isFinite(w)) return true
	const now = Date.now()
	return w < now - ARCHIVE_MONTH_WALL_MAX_SKEW_MS || w > now + ARCHIVE_MONTH_WALL_MAX_SKEW_MS
}

/**
 * 归档分桶：仅 UTC 自然月 `YYYY-MM`（与节点本地时区无关）。
 * @param {number} wallMs HLC wall 毫秒（UTC 语义）
 * @returns {string} `YYYY-MM`
 */
export function archiveMonthKey(wallMs) {
	const d = new Date(Number(wallMs) || Date.now())
	const y = d.getUTCFullYear()
	const m = String(d.getUTCMonth() + 1).padStart(2, '0')
	return `${y}-${m}`
}
