import { registerHooks } from 'node:module'

/**
 * 解析 `npm:` 说明符：剥去版本段后交由默认解析走 node_modules（版本由 Deno 的 node_modules 同步决定）。
 * @param {string} specifier `npm:` 说明符
 * @param {object} context 解析上下文
 * @param {(specifier: string, context: object) => Promise<object>} nextResolve 默认解析
 * @returns {Promise<object>} 解析结果
 */
function resolveNpmSpecifier(specifier, context, nextResolve) {
	let pkg = specifier.slice('npm:'.length)
	const versioned = pkg.match(/^((?:@[^/]+\/)?[^@/]+)@/)
	if (versioned) pkg = pkg.replace(/^((?:@[^/]+\/)?[^@/]+)@[^/]+/, versioned[1])
	return nextResolve(pkg, context)
}

// 注册 resolve hooks，使本进程（及经 NODE_OPTIONS 继承的 Playwright worker）可解析 `npm:` 说明符
// 与前端模块里的 `https://esm.sh/` 导入（与 Deno 端 deno.json 的 esm.sh → npm 映射对齐）。
registerHooks({
	/**
	 * 将 Deno 的 `npm:<pkg>` 说明符映射为裸说明符 `<pkg>`（去掉可能的 `@version` 后缀），
	 * 交由默认解析走 node_modules。Node 默认 ESM loader 只支持 file/data/node 协议。
	 * @param {string} specifier 模块说明符
	 * @param {object} context 解析上下文
	 * @param {(specifier: string, context: object) => Promise<object>} nextResolve 默认解析
	 * @returns {Promise<object>} 解析结果
	 */
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('npm:')) return resolveNpmSpecifier(specifier, context, nextResolve)
		// https://esm.sh/<pkg>[@ver][/subpath][?query] → npm:<pkg>[@ver][/subpath]（query 为 esm.sh 转译参数，与包内容无关，丢弃）
		if (specifier.startsWith('https://esm.sh/')) return resolveNpmSpecifier(`npm:${specifier.slice('https://esm.sh/'.length).replace(/\?.*$/, '')}`, context, nextResolve)
		return nextResolve(specifier, context)
	},
})
