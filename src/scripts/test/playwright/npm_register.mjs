import { registerHooks } from 'node:module'

// 注册 npm:` resolve hook，使本进程（及经 NODE_OPTIONS 继承的 Playwright worker）可解析 `npm:` 说明符。
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
		if (specifier.startsWith('npm:')) {
			let pkg = specifier.slice('npm:'.length)
			const versioned = pkg.match(/^((?:@[^/]+\/)?[^@/]+)@/)
			if (versioned) pkg = pkg.replace(/^((?:@[^/]+\/)?[^@/]+)@[^/]+/, versioned[1])
			return nextResolve(pkg, context)
		}
		return nextResolve(specifier, context)
	},
})
