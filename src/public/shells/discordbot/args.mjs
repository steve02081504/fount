import { runBot } from "./src/server/bot.mjs"

export default async (user, args) => {
	const botname = args[0]
	await runBot(user, botname)
}
