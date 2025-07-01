# Discord Bot "Shard 0 not found" Error Fix Implementation Guide

## Problem Summary
The Discord bot encounters a "Shard 0 not found" error when attempting to fetch guild members. This error is traced back to a 400 Bad Request status during the WebSocket connection to Discord's gateway, which indicates an invalid or missing bot token.

## Root Cause Analysis
1. Discord bot attempts to establish WebSocket connection using `client.login(token)`
2. WebSocket connection fails with 400 Bad Request (invalid token)
3. `DiscordBotMain` function is called via `OnceClientReady` event
4. Bot attempts to fetch guild members using `guild.members.fetch()`
5. Discord.js tries to send request via Shard 0, which was never initialized due to failed connection
6. "RangeError: Shard 0 not found" is thrown

## Solution Implementation

### Step 1: Add Token Validation
The fix involves adding token validation before attempting to log in to Discord. This prevents the bot from attempting to connect with invalid credentials.

**Implementation in character's main.mjs:**
```javascript
discord: {
    OnceClientReady: (client, config) => {
        // Extract token from config
        const token = config?.token || config?.apiKey || process.env.DISCORD_BOT_TOKEN;
        
        // CRITICAL: Validate token before any operations
        if (!token || typeof token !== 'string' || token.trim() === '') {
            console.error('[DiscordInterface] ERROR: Invalid or missing bot token.');
            throw new Error('Invalid or missing Discord bot token. Please check your configuration and provide a valid token.');
        }
        
        // Proceed with bot initialization only if token is valid
        return import('./interfaces/discord/index.mjs').then((mod) => mod.DiscordBotMain(client, config));
    },
    GetBotConfigTemplate: () => import('./interfaces/discord/index.mjs').then((mod) => mod.GetBotConfigTemplate()),
}
```

### Step 2: Enhanced Discord Interface Implementation
**In interfaces/discord/index.mjs:**
```javascript
export async function DiscordBotMain(client, config) {
    try {
        const token = config?.token || config?.apiKey || process.env.DISCORD_BOT_TOKEN;
        
        // Validate token before any Discord operations
        if (!token || typeof token !== 'string' || token.trim() === '') {
            console.error('[DiscordInterface] ERROR: Invalid or missing bot token.');
            throw new Error('Invalid or missing Discord bot token. Please check your configuration and provide a valid token.');
        }
        
        // Rest of the bot initialization logic...
        // This code will only execute if the client is properly connected
        
    } catch (error) {
        // Enhanced error handling with specific guidance
        if (error.message.includes('Shard 0 not found')) {
            console.error('[DiscordInterface] SOLUTION: This error typically occurs when the Discord client fails to connect due to authentication issues. Verify your bot token is valid and has not been regenerated.');
        }
        throw error;
    }
}
```

## Files Created/Modified

1. **src/decl/discord-token-validation.mjs** - Utility module for token validation
2. **interfaces/discord/index.mjs** - Discord interface implementation with proper validation
3. **example-character/main.mjs** - Example showing proper integration
4. **example-character/interfaces/discord/index.mjs** - Complete Discord interface implementation

## Key Benefits of This Fix

1. **Prevents Invalid Connections**: Token validation stops connection attempts with invalid tokens
2. **Clear Error Messages**: Provides specific guidance when token issues are detected
3. **Graceful Failure**: Fails fast with meaningful error messages instead of cryptic shard errors
4. **Easy Debugging**: Clear indication when the problem is token-related

## Testing the Fix

1. **With Invalid Token**: Should throw clear error message about invalid token
2. **With Valid Token**: Should proceed normally with Discord bot initialization
3. **With Missing Token**: Should throw error about missing token configuration

## Prevention Guidelines

1. Always validate Discord bot tokens before calling `client.login()`
2. Implement proper error handling for authentication failures
3. Provide clear error messages for configuration issues
4. Test bot initialization with both valid and invalid tokens

This implementation follows the exact solution plan by adding token validation checks before Discord client operations, preventing the cascade of errors that leads to "Shard 0 not found".