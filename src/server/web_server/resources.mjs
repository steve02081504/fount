import fs from 'node:fs'

import express from 'npm:express'

import { __dirname } from '../base.mjs'

import { watchFrontendChanges } from './watcher.mjs'

/**
 * 用更鲁棒的方式发送文件
 * @param {import('npm:express').Response} res 要发送文件的响应
 * @param {string} path 文件路径
 */
export function betterSendFile(res, path) {
	return res.sendFile(path, err => {
		if (!err) return
		try {
			const fileStream = fs.createReadStream(path)
			res.type(path.split('.').pop())
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
	router.use((req, res, next) => {
		if (req.method != 'GET' && req.method != 'HEAD') return next()
		switch (req.path) {
			case '/apple-touch-icon-precomposed.png':
			case '/apple-touch-icon.png':
				if (fs.existsSync(__dirname + '/src/pages/favicon.png'))
					return betterSendFile(res, __dirname + '/src/pages/favicon.png')
				break
			case '/favicon.svg':
				return betterSendFile(res, __dirname + '/imgs/icon.svg')
		}
		return next()
	})
	watchFrontendChanges('/', __dirname + '/src/pages')
	router.use(express.static(__dirname + '/src/pages'))
}
