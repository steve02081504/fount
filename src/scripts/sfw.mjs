/**
 * 将对象上的 `sfw_*` 键覆盖到去掉前缀后的同名键（与 part.info / profile 约定一致）。
 * @template {Record<string, unknown>} T
 * @param {T | null | undefined} obj 原始对象
 * @returns {T | null | undefined} overlay 后的浅拷贝；入参 falsy 时原样返回
 */
export function applySfwOverlay(obj) {
	if (!obj) return obj
	const out = { ...obj }
	for (const key of Object.keys(obj))
		if (key.startsWith('sfw_'))
			out[key.slice(4)] = obj[key]
	return out
}
