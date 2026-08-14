/**
 * Cloudflare Workers AI chat completions 端点。
 * @param {string} accountId - 账号 ID。
 * @returns {string} 端点。
 */
export function cloudflareWorkersAiUrl(accountId) {
	return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`
}
