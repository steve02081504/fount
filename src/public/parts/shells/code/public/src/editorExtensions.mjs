import { registerCodeLanguage, resolveCodeLanguage } from '/scripts/components/codeSyntax.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { getEditorExtensions } from './endpoints.mjs'

let installation

/**
 * 每页只安装一次用户贡献的编辑器扩展；配置损坏不影响编辑。
 * @param {object} monaco - 编辑器 API。
 * @returns {Promise<object>} 文件语言解析器。
 */
export function loadEditorExtensions(monaco) {
	return installation ||= getEditorExtensions().then(config => installEditorExtensions(monaco, config)).catch(error => {
		installation = null
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
		return { /** @returns {Promise<null>} 退回内置语言。 */
			languageFor: async () => null }
	})
}

/**
 * 安装已校验的贡献集，并保留可释放的 Monaco provider。
 * @param {object} monaco - 编辑器 API。
 * @param {{languages: object[]}} config - 序列化后的用户配置。
 * @returns {Promise<object>} 解析器与释放函数。
 */
export async function installEditorExtensions(monaco, config) {
	const providers = [], suffixes = []
	try {
		for (const definition of config.languages) {
			if (definition.grammar) await registerCodeLanguage(definition)
			else if (await resolveCodeLanguage(definition.id) === 'text') monaco.languages.register({ id: definition.id })
			for (const extension of definition.extensions) suffixes.push({ extension: extension.toLowerCase(), id: definition.id })
			if (!definition.formatter) continue
			providers.push(monaco.languages.registerDocumentFormattingEditProvider(definition.id, {
				/**
				 * @param {object} model - 当前文档。
				 * @param {object} options - Monaco 缩进选项。
				 * @param {object} token - 取消令牌。
				 * @returns {Promise<object[]>} 单次可撤销的整文档编辑。
				 */
				async provideDocumentFormattingEdits(model, options, token) {
					const version = model.getVersionId()
					try {
						const text = await formatInWorker(definition.formatter, {
							text: model.getValue(), language: definition.id, path: model.uri.path,
							tabSize: options.tabSize, insertSpaces: options.insertSpaces,
						}, token)
						if (token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version) return []
						return [{ range: model.getFullModelRange(), text }]
					} catch (error) {
						if (!token.isCancellationRequested) showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
						return []
					}
				},
			}))
		}
	} catch (error) { for (const provider of providers) provider.dispose(); throw error }
	// 长后缀优先，避免 `.d.ts` 被 `.ts` 抢走。
	suffixes.sort((a, b) => b.extension.length - a.extension.length)
	return {
		/**
		 * @param {string} filePath - 文件名。
		 * @returns {Promise<string|null>} 用户关联或交给默认解析。
		 */
		languageFor: async filePath => suffixes.find(item => filePath.toLowerCase().endsWith(item.extension))?.id || null,
		/** @returns {void} 移除格式化 provider。 */
		dispose() { for (const provider of providers) provider.dispose() },
	}
}

/**
 * 在 UI 之外的 worker 里运行格式化，带取消与超时。
 * @param {string} source - 导出 format(document) 的 ES 模块。
 * @param {object} formatRequest - 源文本与格式化选项。
 * @param {object} token - Monaco 取消令牌。
 * @returns {Promise<string>} 格式化后的文本。
 */
export function formatInWorker(source, formatRequest, token) {
	return new Promise((resolve, reject) => {
		if (token.isCancellationRequested) { reject(new Error('Formatting cancelled.')); return }
		const worker = new Worker(new URL('./editorFormatter.worker.mjs', import.meta.url), { type: 'module' })
		let subscription, timer
		/**
		 * @param {Error|null} error - 失败原因。
		 * @param {string} [text] - 结果。
		 * @returns {void} 释放 worker 并结算。
		 */
		const finish = (error, text) => {
			clearTimeout(timer); subscription?.dispose(); worker.terminate()
			if (error) reject(error); else resolve(text)
		}
		/**
		 * @param {MessageEvent} event - worker 结果。
		 * @returns {void} 结算格式化。
		 */
		worker.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.text)
		/**
		 * @param {ErrorEvent} event - worker 失败。
		 * @returns {void} 上报失败。
		 */
		worker.onerror = event => { event.preventDefault(); finish(new Error(event.message)) }
		subscription = token.onCancellationRequested(() => finish(new Error('Formatting cancelled.')))
		timer = setTimeout(() => finish(new Error('Formatter exceeded 10 seconds.')), 10_000)
		worker.postMessage({ source, document: formatRequest })
	})
}
