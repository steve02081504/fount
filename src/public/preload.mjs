// src/public/preload.mjs

// Code to set the theme before rendering

// Get the theme preference from localStorage or default to 'dark'
const getThemePreference = () => {
	const stored = localStorage.getItem('theme');
	if (stored) return stored;
	
	// Check system preference if no stored preference
	if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
		return 'light';
	}
	
	return 'dark'; // Default to dark theme
};

// Apply theme to the document
const applyTheme = (theme) => {
	document.documentElement.setAttribute('data-theme', theme);
};

// Initialize theme immediately to prevent FOUC
const theme = getThemePreference();
applyTheme(theme);

// Export for use in other modules
export { getThemePreference, applyTheme };