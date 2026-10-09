/**
 * Service Worker 路由决策的纯函数集合。
 * 本模块不引用 self / caches / fetch 等浏览器全局，便于在 Deno 中直接单元测试；
 * service_worker.mjs 只保留真正的缓存读写逻辑。
 */

/**
 * 判断请求是否应进入冷启动模式。
 * 仅同源导航请求可以开启冷启动：非导航（子资源 / fetch）或跨源请求绝不翻转状态，
 * 否则任意标签页访问 `/` 都会污染所有已打开的 Hub 标签页。
 * @param {object} params - 参数对象。
 * @param {{ mode?: string } | null} params.request - 请求对象（可为带 mode 的 Request 或普通对象）。
 * @param {URL} params.url - 请求 URL。
 * @param {string} params.origin - 当前 Service Worker 的同源地址（self.location.origin）。
 * @returns {boolean} 是否应进入冷启动。
 */
export function isColdBootNavigationRequest({ request, url, origin }) {
	if (request?.mode !== 'navigate') return false
	if (url.origin !== origin) return false
	return url.pathname === '/' || url.pathname === '/index.html' || url.searchParams.get('cold_bootting') === 'true'
}

/**
 * 判断 URL 是否豁免缓存优先策略。
 * `/api/`、`/ws/`、`/virtual_files/` 下的请求携带按用户鉴权的数据，必须走网络优先，
 * 且不得写入 Cache Storage（否则会被跨用户共享并在缓存中滞留）。
 * @param {URL} url - 请求 URL。
 * @returns {boolean} 是否豁免缓存优先。
 */
export function isCacheFirstExemptUrl(url) {
	const { pathname } = url
	return pathname === '/api' || pathname.startsWith('/api/')
		|| pathname === '/ws' || pathname.startsWith('/ws/')
		|| pathname === '/virtual_files' || pathname.startsWith('/virtual_files/')
}

/**
 * 把请求 mode 规范化为 `new Request(input, init)` 可接受的值。
 * `navigate` 只由浏览器为导航请求生成，Request 构造器会拒绝该 mode；重建/重试请求时降级为 `same-origin`。
 * @param {string} mode - 原始请求 mode。
 * @returns {string} 可用于构造 Request 的 mode。
 */
export function constructibleRequestMode(mode) {
	return mode === 'navigate' ? 'same-origin' : mode
}

/**
 * 判断是否为携带冷启动标记的导航请求（此时响应已带 `cold_bootting` 标记）。
 * @param {URL} url - 请求 URL。
 * @returns {boolean} 是否携带冷启动标记。
 */
export function isColdBootMarkedRequest(url) {
	return url.searchParams.has('cold_bootting')
}

/**
 * 判断一个 GET 请求的响应是否允许写入 Cache Storage。
 * 鉴权数据（豁免 URL）与以 `cold_bootting` 标记的冷启动导航均不可缓存。
 * @param {object} params - 参数对象。
 * @param {{ method?: string } | null} params.request - 请求对象。
 * @param {URL} params.url - 请求 URL。
 * @returns {boolean} 是否可缓存。
 */
export function shouldCacheResponse({ request, url }) {
	if (request?.method !== 'GET') return false
	if (isCacheFirstExemptUrl(url)) return false
	if (isColdBootMarkedRequest(url)) return false
	return true
}

/**
 * 首次抓取跨域资源时使用的模式。
 * 必须用 cors 抓：no-cors 请求拿到的是 opaque 响应，读不到内容也不会被写进缓存
 * （`fetchAndCache` 明确跳过 opaque），而同一份跨域资源在页面里几乎总有两种消费方式
 * （`<img>` / `url()` 的 no-cors 与 svgInliner 的 cors fetch），
 * 于是「no-cors 抓一次 → HEAD 探测 ACAO → cors 再抓一次」＝ 2 GET + 1 HEAD 全是白挨的；
 * 抓到可读的那份并缓存后，两种消费复用同一份。
 * 同源资源没有 opaque 问题，按请求本身的模式抓即可。
 * @param {object} params - 参数对象。
 * @param {URL} params.url - 请求 URL。
 * @param {string} params.origin - 当前 Service Worker 的来源（self.location.origin）。
 * @returns {'cors' | 'request'} 首次抓取使用的模式。
 */
export function firstFetchModeFor({ url, origin }) {
	return url.origin === origin ? 'request' : 'cors'
}
