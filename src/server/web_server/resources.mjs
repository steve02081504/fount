import fs from 'node:fs'

import express from 'npm:express'

import { auth_request, getUserByReq } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { getPartList } from '../parts_loader.mjs'

import { watchFrontendChanges } from './watcher.mjs'

/**
 * 用更鲁棒的方式发送文件
 * @param {import('npm:express').Response} res 要发送文件的响应
 * @param {string} path 文件路径
 * @returns {import('npm:express').Response} 响应
 */
export function betterSendFile(res, path) {
	return res.sendFile(path, err => {
		if (!err) return
		try {
			const fileStream = fs.createReadStream(path)
			try { res.type(path.split('.').pop()) } catch (e) { /* ignore */ }
			fileStream.pipe(res)
			fileStream.on('end', () => res.end())
			fileStream.on('error', err => res.status(500).send(err))
		} catch (e) { res.status(500).send(e) }
	})
}

/**
 * 为应用程序注册资源路由。
 * @param {import('npm:express').Router} router - 要在其上注册路由的 Express 路由器。
 * @returns {void}
 */
export function registerResources(router) {
	router.use(async (req, res, next) => {
		if (req.method != 'GET' && req.method != 'HEAD') return next()
		switch (req.path) {
			case '/llms.txt': {
				const basePath = __dirname + '/src/public/pages/llms.txt'
				let content = fs.readFileSync(basePath, 'utf8') + `\

---

## Shell 列表与使用指南
`
				const authenticated = await auth_request(req, res)
				if (authenticated) {
					const { username } = await getUserByReq(req)
					const shellList = getPartList(username, 'shells')
					if (shellList.length)
						content += `\
当前可用的 shell 如下。针对每个 shell 的详细 API 使用说明，请请求对应路径下的 llms.txt：
${shellList.join('、')}
地址统一为 /parts/shells:<shellname>/llms.txt
`
					else
						content += `\
当前暂无可用 shell。
`
				}
				else
					content += `\
需要先进行认证（如使用 API Key）后才能获取 shell 相关内容。
认证后再次请求本文件将看到当前用户的 shell 列表及各 shell 的 llms.txt 路径说明。
`

				return res.type('text/plain; charset=utf-8').send(content)
			}
			case '/apple-touch-icon-precomposed.png':
			case '/apple-touch-icon.png':
				if (fs.existsSync(__dirname + '/src/public/pages/favicon.png'))
					return betterSendFile(res, __dirname + '/src/public/pages/favicon.png')
				break
			case '/favicon.svg':
				return betterSendFile(res, __dirname + '/imgs/icon.svg')
		}
		return next()
	})
	watchFrontendChanges('/', __dirname + '/src/public/pages')
	router.use(express.static(__dirname + '/src/public/pages'))
}
