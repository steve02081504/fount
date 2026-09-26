const DEFAULT_NAVIGATION_TIMEOUT = 17 * 1000

/**
 * 等待给定的毫秒数。
 * @param {number} milliseconds - 等待时长。
 * @returns {Promise<void>} 等待完成。
 */
function sleep(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/**
 * 根据浏览器可执行文件路径创建一个 Puppeteer 启动器函数。
 * @param {string} executablePath - 浏览器可执行文件的路径。
 * @param {string} name - 浏览器名称（'firefox'、'chrome' 等）。
 * @returns {Promise<(configs: object) => Promise<object>>} 接受配置并启动 Puppeteer 的函数。
 */
export async function NewBrowserGener(executablePath, name) {
	const puppeteer = await import('npm:puppeteer-core@^24.9.0').then(m => m.default)
	return configs => puppeteer.launch({
		...configs,
		browser: name,
		product: name,
		executablePath,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-features=IsolateOrigins,site-per-process',
			'--disable-site-isolation-trials',
			'--disable-blink-features=AutomationControlled',
			...configs.args || []
		]
	})
}

/**
 * 根据浏览器名称创建一个 Puppeteer 启动器函数。
 * @param {string} name - 浏览器名称（'firefox'、'chrome' 等）。
 * @returns {Promise<((configs: object) => Promise<object>) | null>} 启动器函数，找不到浏览器则为 null。
 */
export async function NewBrowserGenerByName(name) {
	const { where_command } = await import('npm:@steve02081504/exec')
	const executorPath = await where_command(name)
	if (!executorPath) return null
	return NewBrowserGener(executorPath, name)
}

/**
 * 按优先级（chrome、firefox、edge）尝试启动一个可用的浏览器。
 * @param {object} configs - Puppeteer 的启动配置。
 * @returns {Promise<object>} Puppeteer 浏览器实例。
 * @throws {Error} 没有可用浏览器时抛出。
 */
export async function NewBrowser(configs) {
	for (const name of ['chrome', 'firefox']) {
		const generator = await NewBrowserGenerByName(name)
		if (generator) try {
			const browser = await generator(configs)
			console.info(`Successfully launched browser: ${name}`)
			return browser
		}
		catch (error) {
			console.warn(`Failed to launch ${name}: ${error.stack}. Trying next browser.`)
		}
	}
	try {
		const { where_command } = await import('npm:@steve02081504/exec')
		const edgePath = await where_command('msedge') || (await import('npm:edge-paths')).getEdgePath()
		const generator = await NewBrowserGener(edgePath, 'chrome')
		if (generator) {
			const browser = await generator(configs)
			console.info('Successfully launched browser: Edge')
			return browser
		}
	}
	catch (error) {
		console.warn(`Failed to launch Edge: ${error.stack}.`)
	}
	throw new Error('Failed to launch any supported browser (Chrome, Firefox or Edge).')
}

/**
 * 在页面上下文中清理 DOM，移除脚本、样式与不可见元素。
 * @param {object} page - Puppeteer 页面实例。
 * @returns {Promise<void>} 清理完成。
 */
async function cleanPageDom(page) {
	await page.evaluate(() => {
		document.querySelectorAll('script, style, link[rel="stylesheet"], header, footer, noscript').forEach(el => el.remove())
		document.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'))
		document.querySelectorAll('div[class*="highlight"] pre[class*="lineno"]').forEach(el => el.remove())
		document.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(el => el.remove())
		document.querySelectorAll('*').forEach(el => {
			if (!el.isConnected) return
			try {
				// deno-lint-ignore no-window
				const style = window.getComputedStyle(el)
				if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
					el.remove()
			}
			catch { /* 忽略获取样式的错误 */ }
		})
		document.querySelectorAll(
			'div[class*="sidebar-container"], [id*="dismissable-notice"], [class*="navbar-mini"], [class*="navbar"]'
		).forEach(el => el.remove())
	})
}

/** 针对特定站点的额外清理规则。 */
const SITE_CLEANUP_CONFIGS = [
	{
		pattern: 'wikipedia.', selectors: [
			'[class*="vector-sticky-pinned-container"]', '[class*="vector-page-toolbar"]',
			'[class*="vector-body-before-content"]', '[class*="mw-editsection"]', '[class*="mw-jump-link"]'
		]
	},
	{
		pattern: 'moegirl.', selectors: [
			'[id*="moe-article-header-container"]', '[class*="infobox-incompleted"]', '[id*="moe-mobile-toolbar"]',
			'[id*="moe-after-content"]', '[id*="moe-global-siderail"]', '[id*="moe-global-toolbar"]',
			'[id*="moe-open-in-app"]', '[id*="moe-page-tools-container"]', '[class*="n-notification-container"]',
			'[class*="n-message-container"]', '[id*="moe-a11y-navigations"]',
			'[id*="siteNotice"]', '[id*="siteSub"]', '[class*="mw-jump-link"]', '[id*="mw-navigation"]'
		],
		/** 移除红链的 href。 */
		actions: () => {
			document.querySelectorAll('a[href*="&redlink=1"]').forEach(el => el.removeAttribute('href'))
		}
	},
	{
		pattern: 'baike.baidu.com', selectors: [
			'[class*="index-module_pageHeader"]', '[class*="catalogWrapper"]', '[class*="sideContent"]',
			'[id*="J-related-search"]', '[class*="page-footer-content"]', '[class*="copyright"]',
			'[class*="ttsPlayerWrapper"]', '[class*="weChatLayer"]', '[class*="topToolsWrap"]'
		]
	},
	{ pattern: 'learn.microsoft.com', selectors: ['[class*="popover-content"]'] },
	{
		pattern: 'stackoverflow.com', selectors: [
			'[id*="left-sidebar"]', '[id*="signup-modal-container"]', '[id*="homepage-wizard-container"]',
			'[id*="--stacks-s-tooltip"]', '[class*="js-post-menu"]', '[id*="post-form"]'
		]
	},
	{
		pattern: 'lesswrong.com', selectors: [
			'[class*="Header"]', '[class*="Comments"]', '[id*="comments"]', 'footer'
		]
	}
]

/**
 * 应用当前 URL 匹配到的站点清理规则。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} url - 页面 URL。
 * @returns {Promise<void>} 清理完成。
 */
async function applySiteCleanup(page, url) {
	for (const config of SITE_CLEANUP_CONFIGS)
		if (url.includes(config.pattern)) {
			await page.evaluate((selectors, runActions) => {
				selectors.forEach(selector => {
					document.querySelectorAll(selector).forEach(el => el.remove())
				})
				if (runActions) runActions()
			}, config.selectors, config.actions)
			return
		}
}

/**
 * 抓取网页内容，清理 HTML 并转换为 Markdown。
 * @param {string} url - 要抓取的网页 URL。
 * @returns {Promise<string>} 清理并转换后的 Markdown 文本。
 */
export async function MarkdownWebFetch(url) {
	let browser = null
	console.info(`Starting Markdown fetch process for URL: ${url}`)

	try {
		browser = await NewBrowser({ headless: 'new' })
		const page = await browser.newPage()
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36')
		page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT)

		console.info(`Navigating to URL: ${url}`)
		await page.goto(url, { waitUntil: 'domcontentloaded' })

		try {
			await page.waitForSelector('body', { timeout: 10000 })
			await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 })
				.catch(() => console.warn('Network idle wait timed out (non-fatal)'))
		}
		catch (error) {
			console.warn(`Wait for page load incomplete: ${error.message}, proceeding anyway...`)
		}

		const MAX_CLEANUP_RETRIES = 3
		for (let attempt = 0; attempt < MAX_CLEANUP_RETRIES; attempt++) try {
			await cleanPageDom(page)
			await applySiteCleanup(page, url)
			console.info('DOM cleanup finished.')
			break
		}
		catch (error) {
			console.error(`Error during DOM cleanup execution (page.evaluate): ${error}`)
			await page.waitForSelector('article, main, .PostsPage-postContent, body', { timeout: 15000 }).catch(() => { })
			await sleep(5000)
		}

		const content = await page.content()
		const TurndownService = await import('npm:turndown').then(m => m.default)
		const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
		turndownService.remove('script')
		turndownService.remove('style')

		const markdown = turndownService.turndown(content)
		return markdown.split('\n')
			.filter(line => line.trim() !== '')
			.filter((line, index, lines) => lines.indexOf(line) === index)
			.join('\n')
	}
	catch (error) {
		console.error(`An error occurred during the MarkdownWebFetch process: ${error}`)
		throw error
	}
	finally {
		if (browser) {
			console.info('Closing the browser.')
			await browser.close()
		}
	}
}
