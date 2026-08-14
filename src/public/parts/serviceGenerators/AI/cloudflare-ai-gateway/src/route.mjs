/**
 * 按模型前缀选择 AI Gateway 通道。
 * @param {object} args - 参数。
 * @param {string} args.accountId - 账号 ID。
 * @param {string} args.gatewayId - Gateway ID。
 * @param {string} args.model - 模型名。
 * @returns {{ channel: 'openai' | 'anthropic' | 'compat', url: string, model: string }} 通道。
 */
export function cloudflareGatewayRoute({ accountId, gatewayId, model }) {
	const base = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}`
	if (model.startsWith('anthropic/'))
		return { channel: 'anthropic', url: `${base}/anthropic`, model: model.slice('anthropic/'.length) }
	if (model.startsWith('openai/'))
		return { channel: 'openai', url: `${base}/openai/chat/completions`, model: model.slice('openai/'.length) }
	return { channel: 'compat', url: `${base}/compat/chat/completions`, model }
}
