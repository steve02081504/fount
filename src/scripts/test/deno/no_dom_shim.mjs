/**
 * 后端 Deno 测试的 DOM shim 地雷：由 `fount test` 以 `--preload` 注入每个 `deno test`
 * 子进程（suite_run.mjs 直接 `deno test` 套件 + serial.mjs 逐文件子进程）。
 *
 * 任何对浏览器 DOM 全局（window / document / HTMLElement / …）的赋值都会立即抛错，
 * 使「在 Deno 里装 happy-dom / linkedom / jsdom 之类的虚拟 DOM 跑前端代码」当场爆炸。
 * 前端代码一律写 Playwright 前端测试（test/frontend/*.spec.mjs），逻辑断言可经
 * modulePage（见 src/scripts/test/docs/playwright.md）在真实页面里 evaluate。
 */

/** 被封禁赋值的 DOM 全局名（Deno 环境下这些名字不应被后端测试写入）。 */
const TRAPPED_NAMES = [
	'window', 'document',
	'HTMLElement', 'HTMLScriptElement', 'HTMLDivElement', 'SVGElement', 'Image',
	'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'Document',
	'DOMParser', 'XMLSerializer', 'MutationObserver', 'IntersectionObserver',
	'CSSStyleSheet', 'CSSStyleRule',
	'getComputedStyle', 'requestAnimationFrame',
	'localStorage', 'sessionStorage',
]

/**
 * 生成赋值即抛错的错误。
 * @param {string} name 被赋值的全局名
 * @returns {Error} 带修复指引的错误
 */
function domShimError(name) {
	return new Error(
		`[fount test] 后端测试禁止安装浏览器 DOM（检测到对 globalThis.${name} 的赋值）。`
		+ '前端代码必须在前端测试：写 test/frontend/*.spec.mjs（Playwright），'
		+ '纯逻辑断言可用 modulePage fixture 在真实页面里 evaluate —— 见 src/scripts/test/AGENTS.md 与 src/scripts/test/docs/playwright.md。'
		+ '禁止在 Deno 测试里引入 happy-dom / linkedom / jsdom 等虚拟 DOM。',
	)
}

for (const name of TRAPPED_NAMES) {
	const existing = Object.getOwnPropertyDescriptor(globalThis, name)
	// Deno 自带的全局（如 navigator）保留原 getter，仅封掉赋值；不可配置的无法拦截，跳过。
	const getter = existing && 'get' in existing ? existing.get : undefined
	if (existing && !existing.configurable) continue
	try {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			enumerable: existing?.enumerable ?? false,
			...getter ? { get: getter } : {
				/**
				 * @returns {undefined} 无值（读取保持 undefined，行为与未装 shim 的 Deno 一致）
				 */
				get() {
					return undefined
				},
			},
			/**
			 * @param {unknown} _value 被赋的值（丢弃）
			 * @returns {never} 永不返回，直接抛错
			 */
			set(_value) {
				throw domShimError(name)
			},
		})
	}
	catch { /* 拦不下的名字不阻塞测试进程启动 */ }
}

/**
 * 给 `deno test` 子进程命令插入本模块的 `--preload`（非 `deno test` 原样返回）。
 * @param {string[]} command `deno …` 或已去掉可执行文件的 argv
 * @returns {string[]} 可能插入 preload 后的命令
 */
export function withNoDomShimPreload(command) {
	if (!command.length) return command
	const start = command[0] === 'deno' ? 1 : 0
	if (command[start] !== 'test') return command
	const out = [...command]
	out.splice(start + 1, 0, `--preload=${import.meta.filename}`)
	return out
}
