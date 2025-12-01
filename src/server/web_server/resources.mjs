import fs from 'node:fs'

import express from 'npm:express'

import { __dirname } from '../base.mjs'
import { skip_report } from '../server.mjs'

import { watchFrontendChanges } from './watcher.mjs'

/**
 * 为应用程序注册资源路由。
 * @param {import('npm:express').Router} router - 要在其上注册路由的 Express 路由器。
 * @returns {void}
 */
export function registerResources(router) {
	router.use((req, res, next) => {
		if (req.method != 'GET' && req.method != 'HEAD') return next()
		try {
			switch (req.path) {
				case '/apple-touch-icon-precomposed.png':
				case '/apple-touch-icon.png':
					if (fs.existsSync(__dirname + '/src/pages/favicon.png'))
						return res.sendFile(__dirname + '/src/pages/favicon.png')
					break
				case '/favicon.svg':
					return res.sendFile(__dirname + '/imgs/icon.svg')
			}
		} catch (e) { throw skip_report(e) } // 抽象linux错误，关我屁事
		return next()
	})
	watchFrontendChanges('/', __dirname + '/src/pages')
	router.use(express.static(__dirname + '/src/pages'))
}
