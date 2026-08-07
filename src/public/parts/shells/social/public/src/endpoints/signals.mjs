/** Social 隐私信号（停留时长），不联邦，仅本机聚合用于个性化。 */
import { socialRequest } from './client.mjs'

/**
 * @param {object} body 停留信号 body（entries[] 或单条字段）
 * @returns {Promise<void>}
 */
export function sendDwellSignal(body) {
	return socialRequest('/signals/dwell', { method: 'POST', body: JSON.stringify(body) })
}
