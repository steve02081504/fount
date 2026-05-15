// ==UserScript==
// @name         fount Browser Integration
// @namespace    http://tampermonkey.net/
// @version      0.0.0.0
// @description  Allows fount characters to interact with the web page.
// @author       steve02081504
// @icon         https://steve02081504.github.io/fount/imgs/icon.svg
// @match        *://*/*
// @connect      esm.sh
// @connect      github.com
// @connect      cdn.jsdelivr.net
// @connect      steve02081504.github.io
// @connect      fount.local
// @connect      *
// @homepage     https://github.com/steve02081504/fount
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.xmlHttpRequest
// @grant        GM_info
// @require      ${file_protocol_url}
// ==/UserScript==

/* eslint-disable curly */
/* eslint-disable no-return-assign */
// eslint-disable-next-line no-redeclare
/* global unsafeWindow, file_protocol_url */

setTimeout(() => { // fuck firefox
	if (!unsafeWindow.fount) alert(`\
due to your browser's privacy settings, fount Browser Integration script cant load it from file:// protocol.
you need to install the script manually from:

${file_protocol_url}

and in the future, you'll need manually update the script.

try Chrome if you want to automatically update the script and avoid breaking changes from fount messing up your fount Browser Integration.
`)
}, 2000)
