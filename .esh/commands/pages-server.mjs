/**
 * This script provides a local static page server that mimics the GitHub Pages deployment.
 * It uses Express to serve files from their original locations, avoiding the need for a copy/build step.
 * It is based on the build process defined in `.github/workflows/pages.yaml`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'npm:express'

const app = express()
const port = 8080

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// The deployment workflow copies several directories into the `.github/pages` directory.
// We replicate this structure virtually using express.static middleware.
// The order is important to correctly resolve file paths.

// `cp -r ./src/public/locales ./.github/pages/`
const localesPath = path.join(projectRoot, 'src', 'public', 'locales')
app.use('/fount/locales', express.static(localesPath))

// `cp -r ./imgs ./.github/pages/`
const imgsPath = path.join(projectRoot, 'imgs')
app.use('/fount/imgs', express.static(imgsPath))

// `cp -rn ./src/public/pages/scripts ./.github/pages/`
// The '-n' flag means "no-clobber", so files in the destination (`.github/pages/scripts`) take precedence.
// We replicate this by checking the destination directory first.
const githubScriptsPath = path.join(projectRoot, '.github', 'pages', 'scripts')
app.use('/fount/scripts', express.static(githubScriptsPath))

const srcScriptsPath = path.join(projectRoot, 'src', 'public', 'pages', 'scripts')
app.use('/fount/scripts', express.static(srcScriptsPath))

// Proxy data/comments.json from GitHub Pages when available, otherwise fall through to local static file.
const GITHUB_PAGES_COMMENTS_URL = 'https://steve02081504.github.io/fount/data/comments.json'
app.get('/fount/data/comments.json', async (_req, res, next) => {
	const response = await fetch(GITHUB_PAGES_COMMENTS_URL).catch(() => null)
	if (response?.ok) {
		const data = await response.json()
		return res.json(data)
	}
	return res.json([
		{
			name: 'test user',
			avatar: null,
			feedback: 'test feedback',
			created_at: '2026-03-07 18:45:12'
		},
		{
			name: '测试用户',
			avatar: null,
			feedback: '测试反馈',
			created_at: '2026-03-08 18:45:12'
		},
		{
			name: 'ユーザー',
			avatar: null,
			feedback: 'フィードバック',
			created_at: '2026-03-09 18:45:12'
		}
	])
})

// Serve the main content from `.github/pages` as the root.
// This comes after the specific routes to not intercept them.
const pagesRootPath = path.join(projectRoot, '.github', 'pages')
app.use('/fount', express.static(pagesRootPath))

app.listen(port, () => {
	const url = `http://localhost:${port}/fount`
	console.log(`GitHub Pages local server running at ${url}`)
	console.log('Press Ctrl+C to stop the server.')
})
