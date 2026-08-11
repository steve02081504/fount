/**
 * 【文件】entity/charPartNameMatch.mjs
 * 【职责】对照已安装 chars 列表把输入解析成真实目录名（无 I/O，可纯测）。
 * 【原理】大小写不敏感匹配；命中返回列表原串，否则抛错。
 * 【数据结构】part 名字符串。
 * 【关联】charPartName.mjs（接 getPartList）、pure/char_part_name.test.mjs。
 */

/**
 * 对照已安装 chars 列表解析规范 part 名。
 * @param {unknown} raw 用户/API 输入（可带 `chars/` 前缀）
 * @param {Iterable<string>} partNames 已安装目录名
 * @returns {string} 列表中的真实目录名
 */
export function resolveCharPartNameAgainstList(raw, partNames) {
	const name = String(raw || '').replace(/^chars\//u, '').trim()
	if (!name) throw new Error('charPartName required')
	const lower = name.toLowerCase()
	for (const part of partNames) {
		const candidate = String(part)
		if (candidate.toLowerCase() === lower) return candidate
	}
	throw new Error(`char part not found: ${name}`)
}
