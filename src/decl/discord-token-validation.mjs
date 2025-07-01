/**
 * Discord Bot Token Validation Utility
 * 
 * This module provides token validation functionality that should be used
 * before attempting to log in with Discord.js client to prevent 
 * "Shard 0 not found" errors caused by invalid tokens.
 */

/**
 * Validates a Discord bot token before attempting to log in
 * @param {string} token - The Discord bot token to validate
 * @throws {Error} If the token is invalid or missing
 */
export function validateDiscordToken(token) {
    if (!token || typeof token !== 'string' || token.trim() === '') {
        console.error('[DiscordInterface] ERROR: Invalid or missing bot token.');
        throw new Error('Invalid or missing Discord bot token. Please check your configuration and provide a valid token.');
    }
    
    // Additional validation: Check if token looks like a valid Discord bot token
    const trimmedToken = token.trim();
    
    // Discord bot tokens typically have a specific format
    // They should not be empty after trimming and should have reasonable length
    if (trimmedToken.length < 50) {
        console.error('[DiscordInterface] ERROR: Token appears to be too short to be a valid Discord bot token.');
        throw new Error('Discord bot token appears to be invalid (too short). Please check your configuration.');
    }
    
    console.log('[DiscordInterface] Token validation passed, proceeding with login...');
}

/**
 * Safely login to Discord with token validation
 * @param {Client} client - Discord.js client instance
 * @param {string} token - Discord bot token
 * @returns {Promise} Promise that resolves when login is successful
 */
export async function safeDiscordLogin(client, token) {
    // Validate token before attempting login
    validateDiscordToken(token);
    
    try {
        // Attempt to login with the validated token
        return await client.login(token);
    } catch (error) {
        console.error('[DiscordInterface] ERROR: Failed to login to Discord:', error.message);
        
        // Provide more specific error messages based on common issues
        if (error.message.includes('400') || error.message.includes('Bad Request')) {
            throw new Error('Discord login failed with 400 Bad Request. Please verify your bot token is correct and has not been regenerated.');
        } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            throw new Error('Discord login failed with 401 Unauthorized. Your bot token is invalid or expired.');
        } else {
            throw new Error(`Discord login failed: ${error.message}`);
        }
    }
}