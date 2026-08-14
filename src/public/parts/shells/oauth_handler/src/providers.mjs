import { Buffer } from 'node:buffer'

/**
 * 从 Codex JWT 取出 ChatGPT account id。
 * @param {string} accessToken - access token。
 * @returns {string | undefined} account id。
 */
export function chatgptAccountIdFromJwt(accessToken) {
	const payload = accessToken.split('.')[1]
	if (!payload) return
	const json = JSON.parse(Buffer.from(payload, 'base64url').toString())
	const accountId = json['https://api.openai.com/auth']?.chatgpt_account_id
	if (typeof accountId === 'string' && accountId) return accountId
}

/**
 * 从 Copilot token 的 proxy-ep 推出 API base URL。
 * @param {string} [token] - Copilot 短时 token。
 * @param {string} [enterpriseDomain] - GitHub Enterprise 域名。
 * @returns {string} API origin。
 */
export function copilotBaseUrl(token, enterpriseDomain) {
	const match = token?.match(/proxy-ep=([^;]+)/)
	if (match) return `https://${match[1].replace(/^proxy\./, 'api.')}`
	if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`
	return 'https://api.individual.githubcopilot.com'
}

/**
 * 是否为回环 / 私网 / 链路本地等内网主机名。
 * @param {string} hostname - 已解析 hostname。
 * @returns {boolean} 内网则为 true。
 */
function isInternalHostname(hostname) {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
	if (host === 'localhost' || host.endsWith('.localhost') || host === 'localhost.localdomain') return true
	if (host === '::1' || host === '0.0.0.0' || host === '::' || host === '[::1]') return true
	if (host.includes(':')) {
		if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
		const mapped = host.match(/:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
		if (mapped) return isInternalHostname(mapped[1])
		return false
	}
	const parts = host.split('.').map(Number)
	if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
	const [firstOctet, secondOctet] = parts
	if (firstOctet === 0 || firstOctet === 10 || firstOctet === 127) return true
	if (firstOctet === 169 && secondOctet === 254) return true
	if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return true
	if (firstOctet === 192 && secondOctet === 168) return true
	return false
}

/**
 * 拒绝内网 OAuth 主机。
 * @param {string} hostname - hostname。
 * @returns {void}
 */
function assertPublicHostname(hostname) {
	if (isInternalHostname(hostname))
		throw new Error(`Refusing internal OAuth host: ${hostname}`)
}

/**
 * 规范化 GitHub 域名。
 * @param {string} [input] - 用户输入的 URL 或域名。
 * @returns {string} hostname。
 */
export function githubDomain(input) {
	const trimmed = input?.trim()
	if (!trimmed) return 'github.com'
	const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`)
	assertPublicHostname(url.hostname)
	return url.hostname
}

/**
 * Codex（ChatGPT）PKCE 登录参数。
 */
export const CODEX = {
	id: 'openai-codex',
	clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
	authorizeUrl: 'https://auth.openai.com/oauth/authorize',
	tokenUrl: 'https://auth.openai.com/oauth/token',
	redirectUri: 'http://localhost:1455/auth/callback',
	hookPort: 1455,
	hookPath: '/auth/callback',
	scope: 'openid profile email offline_access',
}

/**
 * Claude Pro/Max PKCE 登录参数。
 */
export const ANTHROPIC = {
	id: 'anthropic',
	clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
	authorizeUrl: 'https://claude.ai/oauth/authorize',
	tokenUrl: 'https://platform.claude.com/v1/oauth/token',
	redirectUri: 'http://localhost:53692/callback',
	hookPort: 53692,
	hookPath: '/callback',
	scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
}

/**
 * GitHub Copilot device flow 参数。
 */
export const COPILOT = {
	id: 'github-copilot',
	clientId: 'Iv1.b507a08c87ecfe98',
	headers: {
		'User-Agent': 'GitHubCopilotChat/0.35.0',
		'Editor-Version': 'vscode/1.107.0',
		'Editor-Plugin-Version': 'copilot-chat/0.35.0',
		'Copilot-Integration-Id': 'vscode-chat',
	},
}

/**
 * 换 Codex authorization code。
 * @param {string} code - 授权码。
 * @param {string} verifier - PKCE verifier。
 * @returns {Promise<object>} oauth 凭证。
 */
export async function exchangeCodexCode(code, verifier) {
	const response = await fetch(CODEX.tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: CODEX.clientId,
			code,
			code_verifier: verifier,
			redirect_uri: CODEX.redirectUri,
		}),
	})
	const json = await response.json()
	if (!response.ok) throw new Error(json.error_description || json.error || `Codex token exchange ${response.status}`)
	const accountId = chatgptAccountIdFromJwt(json.access_token)
	if (!accountId) throw new Error('Codex token missing ChatGPT account id')
	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		accountId,
	}
}

/**
 * 刷新 Codex token。
 * @param {object} credentials - 现有凭证。
 * @returns {Promise<object>} 新凭证。
 */
export async function refreshCodexToken(credentials) {
	const response = await fetch(CODEX.tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: credentials.refresh,
			client_id: CODEX.clientId,
		}),
	})
	const json = await response.json()
	if (!response.ok) throw new Error(json.error_description || json.error || `Codex refresh ${response.status}`)
	const accountId = chatgptAccountIdFromJwt(json.access_token) || credentials.accountId
	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		accountId,
	}
}

/**
 * 换 Anthropic authorization code。
 * @param {string} code - 授权码。
 * @param {string} state - 与 verifier 相同的 state。
 * @param {string} verifier - PKCE verifier。
 * @returns {Promise<object>} oauth 凭证。
 */
export async function exchangeAnthropicCode(code, state, verifier) {
	const response = await fetch(ANTHROPIC.tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({
			grant_type: 'authorization_code',
			client_id: ANTHROPIC.clientId,
			code,
			state,
			redirect_uri: ANTHROPIC.redirectUri,
			code_verifier: verifier,
		}),
	})
	const json = await response.json()
	if (!response.ok) throw new Error(json.error?.message || json.error || `Anthropic token exchange ${response.status}`)
	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000 - 5 * 60 * 1000,
	}
}

/**
 * 刷新 Anthropic token。
 * @param {object} credentials - 现有凭证。
 * @returns {Promise<object>} 新凭证。
 */
export async function refreshAnthropicToken(credentials) {
	const response = await fetch(ANTHROPIC.tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({
			grant_type: 'refresh_token',
			client_id: ANTHROPIC.clientId,
			refresh_token: credentials.refresh,
		}),
	})
	const json = await response.json()
	if (!response.ok) throw new Error(json.error?.message || json.error || `Anthropic refresh ${response.status}`)
	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000 - 5 * 60 * 1000,
	}
}

/**
 * 开始 GitHub Copilot device flow。
 * @param {string} [enterpriseUrl] - GitHub Enterprise 域名或 URL。
 * @returns {Promise<object>} device 码字段。
 */
export async function startCopilotDevice(enterpriseUrl) {
	const domain = githubDomain(enterpriseUrl)
	const response = await fetch(`https://${domain}/login/device/code`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': COPILOT.headers['User-Agent'],
		},
		body: new URLSearchParams({
			client_id: COPILOT.clientId,
			scope: 'read:user',
		}),
	})
	const json = await response.json()
	if (!response.ok) throw new Error(json.error_description || json.error || `Copilot device ${response.status}`)
	if (json.verification_uri)
		assertPublicHostname(new URL(json.verification_uri).hostname)
	return { ...json, domain }
}

/**
 * 轮询 GitHub device token。
 * @param {object} device - startCopilotDevice 返回值。
 * @param {AbortSignal} [signal] - 取消信号。
 * @returns {Promise<string>} GitHub access token。
 */
export async function pollCopilotGithubToken(device, signal) {
	const deadline = Date.now() + device.expires_in * 1000
	let intervalMs = Math.max(1000, device.interval * 1000)
	while (Date.now() < deadline) {
		if (signal?.aborted) throw new Error('Login cancelled')
		await new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, intervalMs)
			signal?.addEventListener('abort', () => {
				clearTimeout(timer)
				reject(new Error('Login cancelled'))
			}, { once: true })
		})
		const response = await fetch(`https://${device.domain}/login/oauth/access_token`, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				'User-Agent': COPILOT.headers['User-Agent'],
			},
			body: new URLSearchParams({
				client_id: COPILOT.clientId,
				device_code: device.device_code,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			}),
		})
		const json = await response.json()
		if (json.access_token) return json.access_token
		if (json.error === 'authorization_pending') continue
		if (json.error === 'slow_down') {
			intervalMs += 5000
			continue
		}
		if (json.error) throw new Error(json.error_description || json.error)
	}
	throw new Error('Device flow timed out')
}

/**
 * 用 GitHub token 换 Copilot 短时 token。
 * @param {string} githubToken - GitHub user token。
 * @param {string} [enterpriseUrl] - Enterprise 域名。
 * @returns {Promise<object>} oauth 凭证。
 */
export async function refreshCopilotToken(githubToken, enterpriseUrl) {
	const domain = githubDomain(enterpriseUrl)
	const response = await fetch(`https://api.${domain}/copilot_internal/v2/token`, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${githubToken}`,
			...COPILOT.headers,
		},
	})
	const json = await response.json()
	if (!response.ok) throw new Error(json.message || `Copilot token ${response.status}`)
	return {
		access: json.token,
		refresh: githubToken,
		expires: json.expires_at * 1000 - 5 * 60 * 1000,
		enterpriseUrl: domain === 'github.com' ? undefined : domain,
	}
}

/**
 * 按 provider id 刷新凭证。
 * @param {string} providerId - openai-codex / anthropic / github-copilot。
 * @param {object} credentials - 现有凭证。
 * @returns {Promise<object>} 新凭证。
 */
export async function refreshOAuthCredentials(providerId, credentials) {
	if (providerId === CODEX.id) return refreshCodexToken(credentials)
	if (providerId === ANTHROPIC.id) return refreshAnthropicToken(credentials)
	if (providerId === COPILOT.id) return refreshCopilotToken(credentials.refresh, credentials.enterpriseUrl)
	throw new Error(`Unknown OAuth provider: ${providerId}`)
}

/**
 * 过期则刷新并写回 config.oauth。
 * @param {object} config - 服务源 config。
 * @param {string} providerId - provider id。
 * @param {() => Promise<void>} SaveConfig - 持久化。
 * @returns {Promise<object>} 可用凭证。
 */
export async function ensureOAuthCredentials(config, providerId, SaveConfig) {
	const creds = config.oauth
	if (!creds?.access) throw new Error('OAuth login required')
	if (Date.now() < creds.expires) return creds
	const next = await refreshOAuthCredentials(providerId, creds)
	config.oauth = next
	await SaveConfig()
	return next
}
