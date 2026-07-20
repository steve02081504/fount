/**
 * 【文件】public/src/streamSlices.mjs
 * 【职责】纯数据：将 WS 流式 slice 合并进消息追踪对象（无 DOM）。
 * 【原理】applySlice 按 type 追加 content/content_for_show/files；applySlices 顺序折叠。
 * 【数据结构】tracked { content?, content_for_show?, files? }、slice { type, ... }。
 * 【关联】StreamRenderer；后端 VOLATILE 流（出站验签）。
 */
/**
 * 将流式 slice 应用到消息追踪对象（纯数据，无 DOM）。
 * @param {{ content?: string, content_for_show?: string, files?: Array }} tracked 可变追踪对象
 * @param {object} slice 增量片段
 * @returns {{ content?: string, content_for_show?: string, files?: Array }} tracked
 */
export function applySlice(tracked, slice) {
	switch (slice.type) {
		case 'append':
			for (const key of ['content_for_show', 'content'])
				if (slice.add?.[key] != null) {
					tracked[key] ??= ''
					tracked[key] += slice.add[key]
				}
			if (slice.add?.files)
				tracked.files = (tracked.files ?? []).concat(slice.add.files)
			break
		case 'rewrite_tail': {
			const key = slice.field || 'content'
			tracked[key] ??= ''
			const safeIndex = Math.min(slice.index, tracked[key].length)
			tracked[key] = tracked[key].substring(0, safeIndex) + slice.content
			break
		}
		case 'set_files':
			tracked.files = slice.files || []
			break
	}
	return tracked
}

/**
 * 依次将多个 slice 应用到追踪对象。
 * @param {{ content?: string, content_for_show?: string, files?: Array }} tracked - 可变追踪对象
 * @param {object[]} slices - 增量片段列表
 * @returns {{ content?: string, content_for_show?: string, files?: Array }} tracked
 */
export function applySlices(tracked, slices) {
	for (const slice of slices)
		applySlice(tracked, slice)
	return tracked
}
