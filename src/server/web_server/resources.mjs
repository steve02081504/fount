import express from 'npm:express'

import { __dirname } from '../base.mjs'

/**
 * @param {import('npm:express').Router} router
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
	router.use(express.static(__dirname + '/src/pages'))
}
