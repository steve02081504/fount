/**
 * 【文件】public/src/endpoints/viewer.mjs
 * 【职责】viewer 身份 REST：`GET /viewer`。
 * 【关联】initCore、deepLinkConsume、profile/index、ownerSettingsPanel。
 */
import { chatFetch } from './groupClient.mjs'

/**
 * 拉取当前 viewer 身份与资料。
 * @returns {Promise<{ nodeHash: string, viewerEntityHash: string|null, profile: object|null, agents: object[], identityRequired?: boolean }>} viewer 载荷
 */
export function getViewer() {
	return chatFetch('/viewer')
}
