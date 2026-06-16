/**
 * 【文件】public/hub/core/avatarCover.mjs
 * 【职责】在圆角头像容器内挂载铺满的封面图模板（Hub 顶栏与资料卡共用）。
 * 【原理】`mountAvatarCover` 向 `.hub-avatar` 等宿主注入 `hub/avatar/cover_img` 模板节点。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../../scripts/template
 */
import { mountTemplate } from '../../../../../scripts/template.mjs'

/**
 * 在圆角头像容器内挂载铺满的封面图。
 * @param {HTMLElement} host 头像宿主（如 `.hub-avatar`）
 * @param {string} src 图片 URL
 * @param {string} alt 替代文本（已转义或由调用方保证安全）
 * @returns {Promise<void>}
 */
export async function mountAvatarCover(host, src, alt) {
	await mountTemplate(host, 'hub/avatar/cover_img', { src, alt })
}
