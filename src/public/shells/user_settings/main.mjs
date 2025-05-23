import {
	getUserByUsername, // Still needed for /view-devices directly
	changeUserPassword,
	revokeUserDevice,
	deleteUserAccount,
	renameUser
} from '../../../../server/auth.mjs'
// events, config, save_config are no longer directly needed here as auth.mjs handles them.

// Placeholder isAdmin middleware (remains unchanged for this task)
const isAdmin = (req, res, next) => {
	// In a real scenario, proper admin/permission checks would be here,
	// likely based on req.user set by the main authentication middleware.
	// For now, assuming permissions are handled by the shell manager via home_registry.json
	// or that any authenticated user can access for now.
	if (req.user)  // Basic check: user must be authenticated
		next()
	else 
	// If no req.user, means the main authenticate middleware didn't pass them.
	// This could be due to /api/shells/* not being under main authentication chain,
	// or if it is, then user isn't logged in.
	// Shell manager is responsible for ensuring only authorized users can access shell APIs.
	// This middleware can be a secondary check if needed.
	// For now, let's assume the shell manager has done its job based on home_registry.json permissions.
		next() 
  
}

function configureUserSettingsRoutes(router) {
	router.use(isAdmin) // Apply to all routes in this shell

	// Change Password
	router.post('/change-password', async (req, res) => {
		const { username, currentPassword, newPassword } = req.body
		if (!username || !currentPassword || !newPassword) 
			return res.status(400).json({ success: false, message: 'Missing required fields.' })
    
		try {
			const result = await changeUserPassword(username, currentPassword, newPassword)
			return res.status(result.success ? 200 : 401).json(result)
		} catch (error) {
			console.error('User Settings Shell: Change password error:', error)
			return res.status(500).json({ success: false, message: 'Internal server error changing password.' })
		}
	})

	// View Devices
	router.post('/view-devices', async (req, res) => {
		const { username } = req.body
		if (!username) 
			return res.status(400).json({ success: false, message: 'Username is required.' })
    
		try {
			const user = getUserByUsername(username) // Direct call to get user data for device list
			if (!user || !user.auth || !user.auth.refreshTokens) 
				return res.status(404).json({ success: false, message: 'User not found or no device information available.' })
      
			const devices = user.auth.refreshTokens.map(token => ({
				deviceId: token.deviceId,
				jti: token.jti,
				expiry: token.expiry,
			}))
			return res.json({ success: true, devices })
		} catch (error) {
			console.error('User Settings Shell: View devices error:', error)
			return res.status(500).json({ success: false, message: 'Error fetching devices.' })
		}
	})

	// Revoke Device
	router.post('/revoke-device', async (req, res) => {
		const { username, deviceId } = req.body
		if (!username || !deviceId) 
			return res.status(400).json({ success: false, message: 'Username and deviceId are required.' })
    
		try {
			const result = await revokeUserDevice(username, deviceId)
			return res.status(result.success ? 200 : 404).json(result)
		} catch (error) {
			console.error('User Settings Shell: Revoke device error:', error)
			return res.status(500).json({ success: false, message: 'Error revoking device access.' })
		}
	})

	// Rename User
	router.post('/rename-user', async (req, res) => {
		const { currentUsername, newUsername } = req.body
		if (!currentUsername || !newUsername) 
			return res.status(400).json({ success: false, message: 'Current and new usernames are required.' })
    
		if (currentUsername === newUsername) 
			return res.status(400).json({ success: false, message: 'New username cannot be the same as the current username.' })
    
		try {
			const result = await renameUser(currentUsername, newUsername)
			return res.status(result.success ? 200 : 400).json(result) // 400 for validation errors like "already exists"
		} catch (error) {
			console.error('User Settings Shell: Rename user error:', error)
			return res.status(500).json({ success: false, message: 'Error renaming user.' })
		}
	})

	// Delete Account
	router.post('/delete-account', async (req, res) => {
		const { username, password } = req.body
		if (!username || !password) 
			return res.status(400).json({ success: false, message: 'Username and password are required.' })
    
		try {
			const result = await deleteUserAccount(username, password)
			return res.status(result.success ? 200 : 401).json(result) // 401 for auth failure
		} catch (error) {
			console.error('User Settings Shell: Delete account error:', error)
			return res.status(500).json({ success: false, message: 'Error deleting account.' })
		}
	})
}

export default {
	info: {
		// Basic info, can be expanded with localized names later if needed by shell manager
		name: 'user-settings',
		version: '1.0.0',
		author: 'Fount AI Assistant', // Or your name/handle
		description: 'Provides API endpoints for user settings management.'
	},
	Load: async (router) => {
		// The router passed here is specific to this shell, typically prefixed like /api/shells/user_settings
		configureUserSettingsRoutes(router)
	},
	Unload: async () => {
		// Cleanup if necessary, usually not needed for simple route additions
	}
	// 'interfaces' can be added if this shell provides specific programmatic interfaces
	// for other shells or parts of the system, like the discordbot example. Not needed for now.
}
