// src/public/base.mjs

// Code for i18n and theme management

import { getThemePreference, applyTheme } from './preload.mjs';

// Internationalization management
let currentLocale = 'en';
let localeData = {};

// Load locale data from API
const loadLocaleData = async (locale = 'en') => {
	try {
		const response = await fetch('/api/getlocaledata', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ locale })
		});
		
		if (response.ok) {
			localeData = await response.json();
			currentLocale = locale;
		} else {
			console.warn('Failed to load locale data, using fallback');
			localeData = {};
		}
	} catch (error) {
		console.warn('Error loading locale data:', error);
		localeData = {};
	}
};

// Get localized text by key path (e.g., "tutorial.title")
const getText = (keyPath, fallback = keyPath) => {
	const keys = keyPath.split('.');
	let current = localeData;
	
	for (const key of keys) {
		if (current && typeof current === 'object' && key in current) {
			current = current[key];
		} else {
			return fallback;
		}
	}
	
	return typeof current === 'string' ? current : fallback;
};

// Apply i18n to all elements with data-i18n attribute
const applyI18n = () => {
	const elements = document.querySelectorAll('[data-i18n]');
	elements.forEach(element => {
		const key = element.getAttribute('data-i18n');
		const text = getText(key);
		
		// Handle different element types
		if (element.tagName === 'INPUT' && element.type === 'text') {
			element.placeholder = text;
		} else if (element.tagName === 'TEXTAREA') {
			element.placeholder = text;
		} else if (element.tagName === 'OPTION') {
			element.textContent = text;
		} else if (element.tagName === 'IMG') {
			element.alt = text;
		} else {
			element.textContent = text;
		}
	});
};

// Theme management functions
const toggleTheme = () => {
	const currentTheme = getThemePreference();
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
	localStorage.setItem('theme', newTheme);
	applyTheme(newTheme);
	return newTheme;
};

// Initialize base functionality
const initializeBase = async () => {
	// Load locale data
	const userLocale = localStorage.getItem('locale') || navigator.language.split('-')[0] || 'en';
	await loadLocaleData(userLocale);
	
	// Apply i18n
	applyI18n();
	
	// Set up theme change listener
	if (window.matchMedia) {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
			if (!localStorage.getItem('theme')) {
				applyTheme(e.matches ? 'dark' : 'light');
			}
		});
	}
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeBase);
} else {
	initializeBase();
}

// Export utilities
export {
	getText,
	applyI18n,
	toggleTheme,
	getThemePreference,
	applyTheme,
	loadLocaleData,
	currentLocale
};