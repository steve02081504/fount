import fs from 'node:fs'

import express from 'npm:express'

import { __dirname } from '../base.mjs'

import { handleLlmsTxt } from './llms.txt.mjs'
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
			case '/llms.txt':
				return handleLlmsTxt(req, res)
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
