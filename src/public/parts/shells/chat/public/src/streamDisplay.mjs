/**
 * 流式预览应展示的文本（优先 content_for_show）。
 * @param {{ content?: string, content_for_show?: string }} tracked 流式追踪对象
 * @returns {string} 展示文本
 */
export function streamDisplayText(tracked) {
	return tracked?.content_for_show ?? tracked?.content ?? ''
}
