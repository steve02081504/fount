/**
 * Discord Interface Implementation with Token Validation
 * 
 * This module implements proper token validation to prevent Discord bot errors
 * such as "Shard 0 not found" which occur when invalid tokens are used.
 */

/**
 * Main Discord bot function with proper token validation
 * @param {Client} client - Discord.js client instance
 * @param {object} config - Bot configuration containing token and other settings
 */
export async function DiscordBotMain(client, config) {
    console.log('[DiscordInterface] Starting Discord bot initialization...');
    
    try {
        // Extract the token from various possible config locations
        const token = config?.token || config?.apiKey || process.env.DISCORD_BOT_TOKEN;
        
        // CRITICAL: Validate token before any operations - this prevents "Shard 0 not found" errors
        if (!token || typeof token !== 'string' || token.trim() === '') {
            console.error('[DiscordInterface] ERROR: Invalid or missing bot token.');
            throw new Error('Invalid or missing Discord bot token. Please check your configuration and provide a valid token.');
        }
        
        console.log('[DiscordInterface] Token validation passed, proceeding with bot operations...');
        
        // Initialize interface configuration
        const interfaceConfig = config?.interface || {};
        let resolvedOwnerId = null;
        
        // Resolve owner by Discord ID first (more reliable than username)
        if (interfaceConfig.OwnerDiscordID) {
            try {
                const ownerUser = await client.users.fetch(interfaceConfig.OwnerDiscordID);
                if (ownerUser) {
                    resolvedOwnerId = ownerUser.id;
                    console.log(`[DiscordInterface] Owner resolved by Discord ID: ${ownerUser.username} (${ownerUser.id})`);
                }
            } catch (e) {
                console.error(`[DiscordInterface] Failed to fetch owner user by OwnerDiscordID ${interfaceConfig.OwnerDiscordID}. Ensure the ID is correct.`, e);
                resolvedOwnerId = null;
            }
        } else if (interfaceConfig.OwnerUserName) {
            // Fallback: Resolve owner by username (requires guild member fetching)
            console.log(`[DiscordInterface] Attempting to resolve owner by username: ${interfaceConfig.OwnerUserName}`);
            let found = false;
            
            for (const guild of client.guilds.cache.values()) {
                try {
                    console.log(`[DiscordInterface] Searching in guild: ${guild.name} (${guild.id})`);
                    
                    // This is the line mentioned in the error trace - ensure client is properly connected
                    const members = await guild.members.fetch();
                    const ownerMember = members.find(m => m.user.username === interfaceConfig.OwnerUserName);
                    
                    if (ownerMember) {
                        resolvedOwnerId = ownerMember.id;
                        found = true;
                        console.log(`[DiscordInterface] Owner found: ${ownerMember.user.username} (${ownerMember.id}) in guild ${guild.name}`);
                        break;
                    }
                } catch (e) {
                    console.error(`[DiscordInterface] Failed to fetch members from guild ${guild.name}:`, e.message);
                    
                    // If this is the "Shard 0 not found" error, it means the client connection failed
                    if (e.message && e.message.includes('Shard 0 not found')) {
                        console.error('[DiscordInterface] CRITICAL: Shard 0 not found error detected. This usually indicates the Discord client failed to connect due to an invalid token.');
                        throw new Error('Discord client connection failed - this is typically caused by an invalid bot token. Please verify your token is correct.');
                    }
                    
                    // Continue to next guild instead of failing completely
                    continue;
                }
            }
            
            if (!found) {
                console.warn(`[DiscordInterface] Owner with username '${interfaceConfig.OwnerUserName}' not found in any accessible guild.`);
            }
        }
        
        // Store resolved owner ID for later use
        if (resolvedOwnerId) {
            console.log(`[DiscordInterface] Bot owner successfully resolved: ${resolvedOwnerId}`);
        } else {
            console.warn('[DiscordInterface] No bot owner could be resolved. Some features may be limited.');
        }
        
        // Additional bot setup and event handlers would go here
        console.log('[DiscordInterface] Discord bot initialization completed successfully.');
        
        // Return success status
        return { success: true, ownerId: resolvedOwnerId };
        
    } catch (error) {
        console.error('[DiscordInterface] Discord bot initialization failed:', error.message);
        
        // Provide helpful error messages for common issues
        if (error.message.includes('Invalid or missing Discord bot token')) {
            console.error('[DiscordInterface] SOLUTION: Please check your bot configuration and ensure a valid Discord bot token is provided.');
        } else if (error.message.includes('Shard 0 not found')) {
            console.error('[DiscordInterface] SOLUTION: This error typically occurs when the Discord client fails to connect due to authentication issues. Verify your bot token is valid and has not been regenerated.');
        }
        
        throw error;
    }
}

/**
 * Returns the bot configuration template
 * @returns {Promise<object>} Configuration template object
 */
export async function GetBotConfigTemplate() {
    return {
        token: '', // Discord bot token - REQUIRED
        interface: {
            OwnerDiscordID: '', // Owner's Discord user ID (recommended)
            OwnerUserName: '',  // Owner's Discord username (fallback)
            // Additional bot configuration options can be added here
        },
        // Other configuration sections...
    };
}