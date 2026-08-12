/**
 * 【文件】entity/charPartNameMatch.mjs
 * 【职责】对照已安装 chars 列表把输入解析成真实目录名（无 I/O，可纯测）。
 * 【原理】大小写不敏感匹配（RegExp `/i`）；命中返回列表原串，否则抛错。
 * 【数据结构】part 名字符串。
 * 【关联】charPartName.mjs（接 getPartList）、pure/char_part_name.test.mjs。
 */
import { escapeRegExp } from '../../../../../../scripts/regex.mjs'

/**
 * 对照已安装 chars 列表解析规范 part 名。
 * @param {string} raw 用户/API 输入（可带 `chars/` 前缀）
 * @param {Iterable<string>} partNames 已安装目录名
 * @returns {string} 列表中的真实目录名
 */
export function resolveCharPartNameAgainstList(raw, partNames) {
	const name = raw.replace(/^chars\//u, '').trim()
	if (!name) throw new Error('charPartName required')
	const re = new RegExp(`^${escapeRegExp(name)}$`, 'iu')
	for (const part of partNames)
		if (re.test(part)) return part
	throw new Error(`char part not found: ${name}`)
}
