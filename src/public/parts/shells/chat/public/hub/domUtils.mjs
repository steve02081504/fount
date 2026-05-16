/**
 * 将文本转为可安全插入 HTML 的字符串。
 * @param {string|null|undefined} text 原始文本
 * @returns {string} 转义后的 HTML 片段
 */
export function escapeHtml(text) {
	const div = document.createElement('div')
	div.textContent = text == null ? '' : String(text)
	return div.innerHTML
}

/** 头像调色板 */
const AVATAR_COLORS = [
	'#5865f2', '#ed4245', '#fee75c', '#57f287', '#eb459e', '#f0b232', '#9b59b6', '#1abc9c',
]

/**
 * 根据名称生成稳定的头像背景色。
 * @param {string} [name] 用户名或展示名
 * @returns {string} CSS 颜色值
 */
export function avatarColor(name) {
	let hash = 0
	const label = name || ''
	for (let charIndex = 0; charIndex < label.length; charIndex++)
		hash = label.charCodeAt(charIndex) + ((hash << 5) - hash)
	return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

/**
 * 取名称首字符作为头像占位字母。
 * @param {string} [name] 用户名或展示名
 * @returns {string} 单个大写字母
 */
export function avatarInitial(name) {
	return (name || '?').charAt(0).toUpperCase()
}

/**
 * 将时间戳格式化为相对「今天/昨天」的简短展示。
 * @param {number} timestamp 毫秒时间戳
 * @returns {string} 本地化时间字符串
 */
export function formatTime(timestamp) {
	const date = new Date(timestamp)
	const now = new Date()
	const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
	if (date.toDateString() === now.toDateString()) return `今天 ${time}`
	const yesterday = new Date(now)
	yesterday.setDate(now.getDate() - 1)
	if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
	return date.toLocaleDateString('zh-CN') + ' ' + time
}
