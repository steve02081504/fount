/**
 * Example Character Main File
 * 
 * This demonstrates how to properly implement Discord bot token validation
 * to prevent "Shard 0 not found" errors caused by invalid tokens.
 */

export default {
    info: {
        name: 'ExampleCharacter',
        description: 'Example character with proper Discord token validation',
        version: '1.0.0'
    },
    
    interfaces: {
        discord: {
            OnceClientReady: (client, config) => {
                // IMPORTANT: Validate token before attempting any Discord operations
                const token = config?.token || config?.apiKey || process.env.DISCORD_BOT_TOKEN;
                
                // Add token validation check as per the final solution plan
                if (!token || typeof token !== 'string' || token.trim() === '') {
                    console.error('[DiscordInterface] ERROR: Invalid or missing bot token.');
                    throw new Error('Invalid or missing Discord bot token. Please check your configuration and provide a valid token.');
                }
                
                // If validation passes, proceed with the Discord bot main function
                return import('./interfaces/discord/index.mjs').then((mod) => mod.DiscordBotMain(client, config));
            },
            GetBotConfigTemplate: () => import('./interfaces/discord/index.mjs').then((mod) => mod.GetBotConfigTemplate()),
        }
    }
};