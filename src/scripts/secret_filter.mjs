/**
 * 工具层机密过滤：把 fount 已知的凭据从工具回执的 agent 层文本中抹去。
 * 凭据来源：`process.env` 中变量名以 APIKEY / KEY 结尾的值，以及所有 AI 服务源的 apikey。
 * 词典在模块加载时一次性构建（env + 各用户 parts_config 里的 AI 源），运行时只做内存替换、不再扫描；
 * 配置编辑由后端触发 `part-config-changed` 事件，本模块只处理 `serviceSources/AI/` 事件并同步更新词典。
 * 由产出 agent 层文本的工具自行调用（file-operations、code-execution、browser-integration、web-browse），
 * 人类展示层（`content_for_show`）不经此过滤器。
 */
import process from 'node:process'

/** AI 服务源配置里视为密钥的字段名。 */
const APIKEY_FIELD = /^api_?key$/i
/** env 变量名命中该后缀即视为机密。 */
const ENV_SECRET_NAME = /(APIKEY|KEY)$/i
/** 短于该长度的值不参与替换，避免把常见短串（单字符 env 等）误当机密全局抹除。 */
const MIN_SECRET_LENGTH = 4
/** agent 层看到机密时替换成的提示文本。 */
export const SECRET_REDACTION_PLACEHOLDER = '[这不是agent该看的内容，已被fount层过滤，如有文件编辑需要可以直接replace-file来避免阅读此内容]'

/**
 * 递归收集配置对象中 apikey 字段的值。
 * @param {unknown} node - 待遍历的配置节点。
 * @param {string[]} found - 收集结果累加器。
 * @returns {void}
 */
function collectApiKeyValues(node, found) {
	if (!node || typeof node !== 'object') return
	for (const [key, value] of Object.entries(node)) {
		if (typeof value === 'string') {
			if (APIKEY_FIELD.test(key)) found.push(value)
			continue
		}
		if (value && typeof value === 'object') collectApiKeyValues(value, found)
	}
}

/**
 * 从一个配置对象里取出可参与过滤的 AI 源密钥值。
 * @param {unknown} data - 服务源配置数据。
 * @returns {string[]} 密钥值列表。
 */
function collectPartSecretValues(data) {
	const values = []
	collectApiKeyValues(data, values)
	return values.filter(value => value.trim().length >= MIN_SECRET_LENGTH)
}

/**
 * 从环境变量中收集机密值（变量名以 APIKEY / KEY 结尾且长度达标）。
 * @param {Record<string, string|undefined>} [env] - 环境变量表，缺省用 `process.env`。
 * @returns {string[]} 机密值列表。
 */
export function collectEnvSecretValues(env = process.env) {
	const values = new Set()
	for (const [name, value] of Object.entries(env))
		if (typeof value === 'string' && ENV_SECRET_NAME.test(name) && value.trim().length >= MIN_SECRET_LENGTH)
			values.add(value)
	return [...values]
}

/** 全局 env 机密（模块加载时确定，运行期不变）。 */
const envSecrets = collectEnvSecretValues()
/** 各 AI 服务源密钥：`username\0partpath` → 密钥值列表。 */
const partSecrets = new Map()
/** 当前生效的机密词典。 */
let dictionary = new Set(envSecrets)

/**
 * 依据 env 与各服务源密钥重建全局词典。
 * @returns {void}
 */
function rebuildDictionary() {
	const next = new Set(envSecrets)
	for (const values of partSecrets.values())
		for (const value of values) next.add(value)
	dictionary = next
}

try {
	const [{ getAllUserNames }, { loadData }, { events }] = await Promise.all([
		import('../server/auth/index.mjs'),
		import('../server/setting_loader.mjs'),
		import('../server/events.mjs'),
	])
	for (const username of getAllUserNames())
		for (const [partpath, data] of Object.entries(loadData(username, 'parts_config') ?? {}))
			if (partpath.startsWith('serviceSources/AI/'))
				partSecrets.set(`${username}\0${partpath}`, collectPartSecretValues(data))
	rebuildDictionary()
	events.on('part-config-changed', ({ username, partpath, data }) => {
		if (!partpath?.startsWith('serviceSources/AI/')) return
		partSecrets.set(`${username}\0${partpath}`, collectPartSecretValues(data))
		rebuildDictionary()
	})
}
catch { /* server 未初始化（纯测试）：只用 env 词典 */ }

/**
 * 把文本中出现的已知机密替换为占位提示（纯函数）。
 * @param {string} text - 待过滤文本。
 * @param {Iterable<string>} secrets - 机密值集合。
 * @returns {string} 过滤后的文本；无机密命中时原样返回。
 */
export function redactSecretValues(text, secrets) {
	if (typeof text !== 'string' || !text || !secrets) return text
	let result = text
	for (const secret of [...secrets].sort((a, b) => b.length - a.length))
		if (result.includes(secret))
			result = result.split(secret).join(SECRET_REDACTION_PLACEHOLDER)
	return result
}

/**
 * 用当前机密词典过滤工具回执的 agent 层文本。
 * @param {string} text - 待过滤文本。
 * @returns {string} 过滤后的文本；无机密命中时原样返回。
 */
export function redactSecrets(text) {
	if (typeof text !== 'string' || !text || !dictionary.size) return text
	return redactSecretValues(text, dictionary)
}
