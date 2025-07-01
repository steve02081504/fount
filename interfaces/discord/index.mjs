/**
 * Discord Interface Implementation
 * 
 * This module handles Discord bot functionality for character integration.
 * It includes proper token validation to prevent "Shard 0 not found" errors.
 */

import { validateDiscordToken, safeDiscordLogin } from '../../src/decl/discord-token-validation.mjs';

/**
 * Main Discord bot initialization function
 * @param {Client} client - Discord.js client instance
 * @param {object} config - Bot configuration object
 */
export async function DiscordBotMain(client, config) {
    console.log('[DiscordInterface] Starting Discord bot initialization...');
    
    try {
        // Extract token from config
        const token = config?.token || config?.apiKey || process.env.DISCORD_BOT_TOKEN;
        
        // Validate token before proceeding
        if (!token || typeof token !== 'string' || token.trim() === '') {
            console.error('[DiscordInterface] ERROR: Invalid or missing bot token.');
            throw new Error('Invalid or missing Discord bot token. Please check your configuration and provide a valid token.');
        }
        
        console.log('[DiscordInterface] Token validation passed, initializing bot...');
        
        // Initialize interface configuration
        const interfaceConfig = config?.interface || {};
        let resolvedOwnerId = null;
        
        // Resolve owner by Discord ID if provided
        if (interfaceConfig.OwnerDiscordID) {
            try {
                const ownerUser = await client.users.fetch(interfaceConfig.OwnerDiscordID);
                if (ownerUser) {
                    resolvedOwnerId = ownerUser.id;
                    console.log(`[DiscordInterface] Owner resolved by ID: ${ownerUser.username}`);
                }
            } catch (e) {
                console.error(`[DiscordInterface] Failed to fetch owner user by OwnerDiscordID ${interfaceConfig.OwnerDiscordID}. Ensure the ID is correct.`, e);
                resolvedOwnerId = null;
            }
        } else if (interfaceConfig.OwnerUserName) {
            // Resolve owner by username (requires fetching guild members)
            let found = false;
            for (const guild of client.guilds.cache.values()) {
                try {
                    console.log(`[DiscordInterface] Fetching members from guild: ${guild.name}`);
                    const members = await guild.members.fetch();
                    const ownerMember = members.find(m => m.user.username === interfaceConfig.OwnerUserName);
                    if (ownerMember) {
                        resolvedOwnerId = ownerMember.id;
                        found = true;
                        console.log(`[DiscordInterface] Owner found by username: ${interfaceConfig.OwnerUserName}`);
                        break;
                    }
                } catch (e) {
                    console.error(`[DiscordInterface] Failed to fetch members from guild ${guild.name}:`, e);
                    // Continue to next guild instead of failing completely
                    continue;
                }
            }
            
            if (!found) {
                console.warn(`[DiscordInterface] Owner with username '${interfaceConfig.OwnerUserName}' not found in any guild.`);
            }
        }
        
        // Additional bot initialization logic would go here
        console.log('[DiscordInterface] Discord bot initialization completed successfully.');
        
    } catch (error) {
        console.error('[DiscordInterface] Failed to initialize Discord bot:', error.message);
        throw error;
    }
}

/**
 * Returns the bot configuration template
 * @returns {Promise<object>} Configuration template
 */
export async function GetBotConfigTemplate() {
    return {
        token: '',
        interface: {
            OwnerDiscordID: '',
            OwnerUserName: '',
            // Additional configuration options
        }
    };
}

/**
 * Character main.mjs integration example
 * This shows how the Discord interface should be integrated in a character's main.mjs
 */
export const CharacterDiscordIntegration = {
    discord: {
        OnceClientReady: (client, config) => {
            // Validate token before any operations
            const token = config?.token || config?.apiKey || process.env.DISCORD_BOT_TOKEN;
            
            if (!token || typeof token !== 'string' || token.trim() === '') {
                console.error('[DiscordInterface] ERROR: Invalid or missing bot token.');
                throw new Error('Invalid or missing Discord bot token. Please check your configuration and provide a valid token.');
            }
            
            // If token is valid, proceed with DiscordBotMain
            return import('./interfaces/discord/index.mjs').then((mod) => mod.DiscordBotMain(client, config));
        },
        GetBotConfigTemplate: () => import('./interfaces/discord/index.mjs').then((mod) => mod.GetBotConfigTemplate()),
    }
};