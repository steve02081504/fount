/**
 * 【文件】public/src/lib/timestampId.mjs
 * 【职责】将时间戳字符串清理为可作 DOM id 的片段（替换空白与标点）。
 * 【原理】replaceAll 空格./: 为下划线。
 * 【数据结构】输入 timestamp 字符串 → 输出 id 片段。
 * 【关联】list/index.mjs、composerAttachments.mjs。
 */
/**
 * 处理时间戳以用作 ID。
 * @param {string} timestamp 时间戳
 * @returns {string} 处理后的 ID
 */
export function processTimeStampForId(timestamp) {
	return timestamp?.replaceAll?.(/[\s./:]/g, '_')
}
