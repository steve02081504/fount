/**
 * IDE 集成配置页：API 密钥、角色选择、一站式 Agent 脚本 URL（Zed 用 deno 跑远端脚本）。
 */
import { applyTheme } from '/scripts/theme.mjs'
import { initTranslations, geti18n, setLocalizeLogic } from '/scripts/i18n.mjs'
import { renderMarkdown } from '/scripts/markdown.mjs'
import { showToastI18n } from '/scripts/toast.mjs'

applyTheme()
await initTranslations('ide_integration')

const ACP_CLIENTS_MDX_URL = 'https://cdn.jsdelivr.net/gh/agentclientprotocol/agent-client-protocol@refs/heads/main/docs/get-started/clients.mdx'
const RE_MAIN_LINK = /^-\s+\[([^\]]+)]\(([^)]+)\)/
const RE_MAIN_PLAIN = /^-\s+(.+)$/
const RE_SUB_THROUGH = /^\s+-\s+through\s+(?:the\s+)?\[([^\]]+)]\(([^)]+)\)/

/**
 * 解析客户端列表 MDX 文件。
 * @param {string} raw - 原始 MDX 内容。
 * @returns {Array<{ name: string, url?: string, through?: Array<{ name: string, url: string }> }>} - 解析后的客户端列表。
 */
function parseClientsMdx(raw) {
	const lines = raw.split(/\r?\n/)
	const result = []
	let current = null
	for (const line of lines) {
		const mainLink = line.match(RE_MAIN_LINK)
		const mainPlain = line.match(RE_MAIN_PLAIN)
		const subThrough = line.match(RE_SUB_THROUGH)
		if (mainLink) {
			if (current) result.push(current)
			current = { name: mainLink[1].trim(), url: mainLink[2].trim() }
		} else if (mainPlain && !line.startsWith(' ')) {
			const name = mainPlain[1].trim()
			if (name && !name.startsWith('-')) {
				if (current) result.push(current)
				current = { name }
			}
		} else if (subThrough && current) {
			current.through = current.through || []
			current.through.push({ name: subThrough[1].trim(), url: subThrough[2].trim() })
		}
	}
	if (current) result.push(current)
	return result
}

/**
 * 将解析后的客户端列表转为 Markdown 列表字符串。
 * @param {Array<{ name: string, url?: string, through?: Array<{ name: string, url: string }> }>} clients - 解析后的客户端列表。
 * @returns {string} 转换后的 Markdown 列表字符串。
 */
function clientsToMarkdown(clients) {
	const lines = []
	for (const client of clients) {
		if (client.url)
			lines.push(`- [${client.name}](${client.url})`)
		else
			lines.push(`- ${client.name}`)
		if (client.through?.length)
			for (const t of client.through)
				lines.push(`  - [${t.name}](${t.url})`)
	}
	return lines.join('\n')
}

/**
 * 加载支持的编辑器列表（使用 Markdown 渲染）。
 */
async function loadSupportedEditors() {
	const container = document.getElementById('supported-editors-container')
	try {
		const res = await fetch(ACP_CLIENTS_MDX_URL)
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		const raw = await res.text()
		const clients = parseClientsMdx(raw)
		container.innerHTML = ''
		const markdown = clientsToMarkdown(clients)
		const fragment = await renderMarkdown(markdown)
		const wrapper = document.createElement('div')
		wrapper.className = 'markdown-body prose prose-sm max-w-none'
		wrapper.appendChild(fragment)
		for (const a of wrapper.querySelectorAll('a[href^="http"]')) {
			a.target = '_blank'
			a.rel = 'noopener noreferrer'
		}
		container.appendChild(wrapper)
	} catch (error) {
		container.innerHTML = ''
		const p = Object.assign(document.createElement('p'), {
			className: 'text-sm text-error'
		})
		setLocalizeLogic(p, () => {
			p.textContent = geti18n('ide_integration.supportedEditorsError', { message: error.message })
		})
		container.appendChild(p)
	}
}

loadSupportedEditors()

const { origin } = window.location
const listUrl = `${origin}/api/getlist/chars`
const scriptPath = `${origin}/parts/shells:ideIntegration/fount_ide_agent.mjs`

const acpCharSelect = document.getElementById('acp-char-select')
const scriptUrlInput = document.getElementById('bridge-script-url')
const configContainer = document.getElementById('acp-config-container')

/** 当前选中的角色 id */
let selectedCharname = ''

/**
 * 根据 API Key 和角色选择构建脚本 URL。
 */
function buildScriptUrl() {
	const key = apiKey || ''
	if (!key || !selectedCharname) {
		scriptUrlInput.value = ''
		return
	}
	const url = new URL(scriptPath)
	url.searchParams.set('fount-apikey', key)
	url.searchParams.set('charname', selectedCharname)
	scriptUrlInput.value = url.toString()
}

/**
 * 更新 Zed 配置预览（使用 Markdown 渲染带语法高亮的代码块）。
 */
async function updateZedConfig() {
	const scriptUrl = scriptUrlInput.value
	configContainer.innerHTML = ''

	if (!scriptUrl) {
		const placeholder = document.createElement('span')
		placeholder.dataset.i18n = 'ide_integration.acpConfigPlaceholder'
		configContainer.appendChild(placeholder)
		return
	}

	const json = `\
{
	"agent_servers": {
		"fount": {
		"type": "custom",
		"command": "deno",
		"args": ["run", "--allow-env", "--allow-net", "${scriptUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]
		}
	}
}`
	const rendered = await renderMarkdown('```jsonc\n' + json + '\n```')
	configContainer.appendChild(rendered)
}

/**
 * 加载角色列表并填充下拉框。
 */
async function loadCharList() {
	const res = await fetch(listUrl, { credentials: 'include' })
	if (!res.ok) {
		const opt = document.createElement('option')
		opt.value = ''
		opt.dataset.i18n = 'ide_integration.charListError'
		acpCharSelect.innerHTML = ''
		acpCharSelect.appendChild(opt)
		return
	}
	const list = await res.json()
	acpCharSelect.innerHTML = ''
	const empty = document.createElement('option')
	empty.value = ''
	empty.dataset.i18n = 'ide_integration.acpCharPlaceholder'
	acpCharSelect.appendChild(empty)
	for (const id of list) {
		const opt = document.createElement('option')
		opt.value = id
		opt.textContent = id
		acpCharSelect.appendChild(opt)
	}
	acpCharSelect.addEventListener('change', () => {
		selectedCharname = acpCharSelect.value
		buildScriptUrl()
		updateZedConfig()
	})
}

document.getElementById('copy-script-url').addEventListener('click', () => {
	const url = scriptUrlInput.value
	if (!url) {
		showToastI18n('warning', 'ide_integration.acpConfigPlaceholder')
		return
	}
	navigator.clipboard.writeText(url)
	showToastI18n('success', 'ide_integration.copied')
})

let apiKey = localStorage.getItem('ide_integration-apikey')

/**
 * 检查并刷新 API Key 状态、角色列表和配置预览。
 */
async function checkApiKey() {
	if (apiKey) {
		const res = await fetch('/api/apikey/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ apiKey }),
		})
		if (res.ok) {
			const data = await res.json()
			if (!data.valid) {
				localStorage.removeItem('ide_integration-apikey')
				apiKey = null
			}
		}
	}
	renderApiKey()
	await loadCharList()
	buildScriptUrl()
	updateZedConfig()
}

/**
 * 生成新的 API Key。
 */
async function generateApiKey() {
	try {
		const res = await fetch('/api/apikey/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ description: 'IDE Integration ACP' }),
		})
		if (!res.ok) {
			const error = await res.json()
			throw new Error(error.message || 'Failed to create API key')
		}
		const data = await res.json()
		apiKey = data.apiKey
		localStorage.setItem('ide_integration-apikey', apiKey)
		renderApiKey()
		buildScriptUrl()
		updateZedConfig()
		showToastI18n('success', 'ide_integration.apiKeyCopied')
	} catch (error) {
		showToastI18n('error', 'ide_integration.apiKeyCreateError', { message: error.message })
	}
}

/**
 * 渲染 API Key 区域（显示密钥或生成按钮）。
 */
function renderApiKey() {
	const section = document.getElementById('api-key-section')
	section.innerHTML = ''
	if (apiKey) {
		const div = document.createElement('div')
		div.className = 'space-y-2'
		div.innerHTML = `
			<div class="join w-full">
				<input type="password" id="ide-apikey-input" class="input input-bordered join-item flex-1" value="${apiKey.replace(/"/g, '&quot;')}" readonly data-i18n="ide_integration.apiKeyInput" />
				<button type="button" id="ide-apikey-copy" class="btn btn-primary join-item" data-i18n="ide_integration.copyButton"></button>
			</div>
		`
		section.appendChild(div)
		document.getElementById('ide-apikey-copy').addEventListener('click', () => {
			navigator.clipboard.writeText(apiKey)
			showToastI18n('success', 'ide_integration.apiKeyCopied')
		})
	} else {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'btn btn-primary'
		btn.dataset.i18n = 'ide_integration.generateApiKeyButton'
		btn.addEventListener('click', generateApiKey)
		section.appendChild(btn)
	}
}

checkApiKey()
