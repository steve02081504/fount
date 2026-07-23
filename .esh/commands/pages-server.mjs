/**
 * 本地静态页面服务器 CLI，模拟 GitHub Pages 部署。
 * 规则实现见 `src/scripts/test/playwright/pages_server.mjs`。
 */
import { startPagesServer } from '../../src/scripts/test/playwright/pages_server.mjs'

const port = Number(process.env.FOUNT_PAGES_PORT) || 8080
const { baseUrl } = await startPagesServer({ port, host: '0.0.0.0' })
console.log(`GitHub Pages local server running at ${baseUrl}`)
console.log('Press Ctrl+C to stop the server.')
