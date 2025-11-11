import express from 'npm:express'

import { __dirname } from '../base.mjs'

import { watchFrontendChanges } from './watcher.mjs'

/**
 * 为应用程序注册资源路由。
 * @param {import('npm:express').Router} router - 要在其上注册路由的 Express 路由器。
 * @returns {void}
 */
export function registerResources(router) {
	router.use((req, res, next) => {
		if (req.method != 'GET') return next()
		switch (req.path) {
			case '/apple-touch-icon-precomposed.png':
			case '/apple-touch-icon.png':
				return res.sendFile(__dirname + '/src/pages/favicon.png')
			case '/favicon.svg':
				return res.sendFile(__dirname + '/imgs/icon.svg')
		}
		return next()
	})
	watchFrontendChanges('/', __dirname + '/src/pages')
	router.use(express.static(__dirname + '/src/pages'))
}
