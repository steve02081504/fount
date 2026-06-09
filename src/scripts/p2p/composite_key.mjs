/** 进程内 Map 复合键（`\0` 分隔；V8 对短 ConsString 拼接很快）。 */

const SEP = '\0'

/**
 * @param {...string} parts 键段（至少一段）
 * @returns {string} 复合键
 */
export function compositeKey(...parts) {
	if (!parts.length) throw new Error('compositeKey: at least one part required')
	return parts.join(SEP)
}

/**
 * @param {...string} prefixParts 前缀段（可为空，表示整表）
 * @returns {string} 带尾部分隔符的前缀（用于子树匹配）
 */
function compositePrefix(...prefixParts) {
	return prefixParts.length ? `${compositeKey(...prefixParts)}${SEP}` : ''
}

/**
 * @template V
 * @param {Map<string, V>} map 根表
 * @param {...string} parts 键段
 * @returns {V | undefined} 命中值
 */
export function mapGet(map, ...parts) {
	return map.get(compositeKey(...parts))
}

/**
 * @template V
 * @param {Map<string, V>} map 根表
 * @param {...string} partsAndValue 键段 + 末尾值
 * @returns {void}
 */
export function mapSet(map, ...partsAndValue) {
	const value = partsAndValue.pop()
	map.set(compositeKey(...partsAndValue), value)
}

/**
 * @template V
 * @param {Map<string, V>} map 根表
 * @param {...string} parts 键段
 * @returns {boolean} 是否存在
 */
export function mapHas(map, ...parts) {
	return map.has(compositeKey(...parts))
}

/**
 * @template V
 * @param {Map<string, V>} map 根表
 * @param {...string} parts 键段
 * @returns {void}
 */
export function mapDelete(map, ...parts) {
	map.delete(compositeKey(...parts))
}

/**
 * 删除以 `prefixParts` 为前缀的所有条目（含更深层级）。
 * @template V
 * @param {Map<string, V>} map 根表
 * @param {...string} prefixParts 前缀段（空则清空整表）
 * @returns {void}
 */
export function mapDeleteByPrefix(map, ...prefixParts) {
	const prefix = compositePrefix(...prefixParts)
	for (const k of [...map.keys()])
		if (!prefix || k.startsWith(prefix)) map.delete(k)
}

/**
 * 遍历前缀子树；回调收到前缀之后的各段与值。
 * @template V
 * @param {Map<string, V>} map 根表
 * @param {...(string | ((tail: string[], value: V) => void))} prefixPartsAndFn 前缀段 + 末尾回调
 * @returns {void}
 */
export function mapForEachUnder(map, ...prefixPartsAndFn) {
	const fn = prefixPartsAndFn.pop()
	const prefix = compositePrefix(...prefixPartsAndFn)
	for (const [k, value] of map) {
		if (!k.startsWith(prefix)) continue
		const tail = k.slice(prefix.length).split(SEP).filter(Boolean)
		fn(tail, value)
	}
}
