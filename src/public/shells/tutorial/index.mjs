// src/public/shells/tutorial/index.mjs

// Event listeners, progress bar updates, end screen logic

import { getText } from '/base.mjs';

// Tutorial state
let tutorialProgress = 0;
let tutorialSteps = [];
let currentStep = 0;
let isRunning = false;

// DOM elements
let tutorialModal;
let progressBar;
let progressElement;
let progressText;
let tutorialEnd;
let startButton;
let skipButton;
let endButton;

// Initialize DOM references
const initDOMElements = () => {
	tutorialModal = document.getElementById('tutorialModal');
	progressBar = document.getElementById('progressBar');
	progressElement = progressBar?.querySelector('progress');
	progressText = document.getElementById('progressText');
	tutorialEnd = document.getElementById('tutorialEnd');
	startButton = document.getElementById('startTutorial');
	skipButton = document.getElementById('skipButton');
	endButton = document.getElementById('endButton');
};

// Define tutorial steps
const initTutorialSteps = () => {
	tutorialSteps = [
		{
			title: getText('tutorial.steps.welcome.title', 'Welcome to Fount'),
			description: getText('tutorial.steps.welcome.description', 'Let\'s explore the features together!'),
			duration: 2000
		},
		{
			title: getText('tutorial.steps.navigation.title', 'Navigation'),
			description: getText('tutorial.steps.navigation.description', 'Learn how to navigate through the interface'),
			duration: 3000
		},
		{
			title: getText('tutorial.steps.features.title', 'Key Features'),
			description: getText('tutorial.steps.features.description', 'Discover the main capabilities of Fount'),
			duration: 3000
		},
		{
			title: getText('tutorial.steps.customization.title', 'Customization'),
			description: getText('tutorial.steps.customization.description', 'Personalize your experience'),
			duration: 2500
		},
		{
			title: getText('tutorial.steps.completion.title', 'Tutorial Complete'),
			description: getText('tutorial.steps.completion.description', 'You\'re ready to start using Fount!'),
			duration: 2000
		}
	];
};

// Update progress bar
const updateProgress = (step, total) => {
	if (!progressElement || !progressText) return;
	
	const percentage = Math.round((step / total) * 100);
	progressElement.value = percentage;
	progressElement.max = 100;
	
	const currentStepData = tutorialSteps[step - 1];
	if (currentStepData) {
		progressText.textContent = `${step}/${total}: ${currentStepData.title}`;
	} else {
		progressText.textContent = `${percentage}%`;
	}
};

// Show tutorial end screen
const showEndScreen = () => {
	if (!progressBar || !tutorialEnd) return;
	
	progressBar.classList.add('hidden');
	tutorialEnd.classList.remove('hidden');
	
	// Trigger confetti animation if available
	if (typeof confetti === 'function') {
		confetti({
			particleCount: 100,
			spread: 70,
			origin: { y: 0.6 }
		});
	}
};

// Execute tutorial step
const executeStep = async (stepIndex) => {
	if (stepIndex >= tutorialSteps.length) {
		showEndScreen();
		return;
	}
	
	const step = tutorialSteps[stepIndex];
	updateProgress(stepIndex + 1, tutorialSteps.length);
	
	// Simulate step execution time
	await new Promise(resolve => setTimeout(resolve, step.duration));
	
	if (isRunning) {
		executeStep(stepIndex + 1);
	}
};

// Start tutorial
const startTutorial = async () => {
	if (!tutorialModal || !progressBar) return;
	
	isRunning = true;
	currentStep = 0;
	
	// Hide modal and show progress bar
	tutorialModal.classList.remove('modal-open');
	tutorialModal.classList.add('hidden');
	progressBar.classList.remove('hidden');
	
	// Initialize and start steps
	initTutorialSteps();
	await executeStep(0);
};

// Skip tutorial
const skipTutorial = () => {
	isRunning = false;
	
	// Navigate to home page
	window.location.href = '/shells/home';
};

// End tutorial
const endTutorial = () => {
	// Navigate to home page
	window.location.href = '/shells/home';
};

// Set up event listeners
const setupEventListeners = () => {
	if (startButton) {
		startButton.addEventListener('click', startTutorial);
	}
	
	if (skipButton) {
		skipButton.addEventListener('click', skipTutorial);
	}
	
	if (endButton) {
		endButton.addEventListener('click', endTutorial);
	}
	
	// Handle page unload
	window.addEventListener('beforeunload', () => {
		isRunning = false;
	});
};

// Initialize tutorial page
const initTutorial = () => {
	initDOMElements();
	setupEventListeners();
	
	// Check if tutorial should be skipped (e.g., user preference)
	const skipTutorialPreference = localStorage.getItem('skipTutorial');
	if (skipTutorialPreference === 'true') {
		skipTutorial();
		return;
	}
	
	// Ensure modal is visible on load
	if (tutorialModal) {
		tutorialModal.classList.add('modal-open');
		tutorialModal.classList.remove('hidden');
	}
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initTutorial);
} else {
	initTutorial();
}

// Export functions for potential external use
export {
	startTutorial,
	skipTutorial,
	endTutorial,
	updateProgress
};