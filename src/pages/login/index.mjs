// Access zxcvbn from the global window object since it's loaded as a classic script
const zxcvbn = window.zxcvbn;

// DOM elements
const authForm = document.getElementById('auth-form');
const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const errorMessage = document.getElementById('error-message');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const confirmPasswordGroup = document.getElementById('confirm-password-group');
const verificationCodeInput = document.getElementById('verification-code');
const verificationCodeGroup = document.getElementById('verification-code-group');
const sendVerificationCodeBtn = document.getElementById('send-verification-code-btn');
const submitBtn = document.getElementById('submit-btn');
const toggleLink = document.getElementById('toggle-link');
const strengthFeedback = document.getElementById('password-strength-feedback');

// Current mode: 'login' or 'register'
let currentMode = 'login';

// Initialize the form
function initializeForm() {
    updateFormMode();
    setupEventListeners();
}

// Update form based on current mode
function updateFormMode() {
    if (currentMode === 'login') {
        confirmPasswordGroup.style.display = 'none';
        verificationCodeGroup.style.display = 'none';
        confirmPasswordInput.required = false;
        verificationCodeInput.required = false;
    } else {
        confirmPasswordGroup.style.display = 'block';
        verificationCodeGroup.style.display = 'block';
        confirmPasswordInput.required = true;
        verificationCodeInput.required = true;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Password strength evaluation
    passwordInput.addEventListener('input', () => {
        evaluatePasswordStrength(passwordInput.value);
    });

    // Form submission
    authForm.addEventListener('submit', handleFormSubmit);

    // Send verification code
    sendVerificationCodeBtn.addEventListener('click', handleSendVerificationCode);

    // Toggle between login and register
    toggleLink.addEventListener('click', toggleFormMode);
}

// Evaluate password strength using zxcvbn
function evaluatePasswordStrength(password) {
    if (!password) {
        strengthFeedback.innerHTML = '';
        return;
    }

    // Use zxcvbn to evaluate password strength
    const result = zxcvbn(password);
    const score = result.score;
    
    let text, color;
    switch (score) {
        case 0:
            text = 'Very Weak';
            color = 'text-error';
            break;
        case 1:
            text = 'Weak';
            color = 'text-warning';
            break;
        case 2:
            text = 'Fair';
            color = 'text-info';
            break;
        case 3:
            text = 'Good';
            color = 'text-success';
            break;
        case 4:
            text = 'Strong';
            color = 'text-success';
            break;
        default:
            text = 'Unknown';
            color = 'text-base-content';
    }
    
    strengthFeedback.innerHTML = `Password strength: <span class="${color}">${text}</span>`;
}

// Handle form submission
async function handleFormSubmit(event) {
    event.preventDefault();
    
    const formData = new FormData(authForm);
    const data = Object.fromEntries(formData.entries());
    
    // Clear previous error messages
    errorMessage.textContent = '';
    
    try {
        if (currentMode === 'register') {
            // Validate password confirmation
            if (data.password !== data['confirm-password']) {
                throw new Error('Passwords do not match');
            }
            
            await handleRegister(data);
        } else {
            await handleLogin(data);
        }
    } catch (error) {
        errorMessage.textContent = error.message;
    }
}

// Handle login
async function handleLogin(data) {
    const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username: data.username,
            password: data.password,
        }),
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Login failed');
    }
    
    // Redirect on successful login
    window.location.href = '/';
}

// Handle registration
async function handleRegister(data) {
    const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username: data.username,
            password: data.password,
            verificationCode: data['verification-code'],
        }),
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Registration failed');
    }
    
    // Redirect on successful registration
    window.location.href = '/';
}

// Handle sending verification code
async function handleSendVerificationCode() {
    const username = usernameInput.value;
    
    if (!username) {
        errorMessage.textContent = 'Please enter a username first';
        return;
    }
    
    try {
        sendVerificationCodeBtn.disabled = true;
        sendVerificationCodeBtn.textContent = 'Sending...';
        
        const response = await fetch('/api/auth/send-verification-code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to send verification code');
        }
        
        // Start countdown
        startCountdown();
    } catch (error) {
        errorMessage.textContent = error.message;
        sendVerificationCodeBtn.disabled = false;
        sendVerificationCodeBtn.textContent = 'Send Code';
    }
}

// Start countdown for verification code button
function startCountdown(seconds = 60) {
    let remaining = seconds;
    
    const interval = setInterval(() => {
        sendVerificationCodeBtn.textContent = `Resend (${remaining}s)`;
        remaining--;
        
        if (remaining < 0) {
            clearInterval(interval);
            sendVerificationCodeBtn.disabled = false;
            sendVerificationCodeBtn.textContent = 'Send Code';
        }
    }, 1000);
}

// Toggle between login and register modes
function toggleFormMode() {
    currentMode = currentMode === 'login' ? 'register' : 'login';
    updateFormMode();
    
    // Clear form data
    authForm.reset();
    errorMessage.textContent = '';
    strengthFeedback.innerHTML = '';
}

// Initialize the form when the DOM is loaded
document.addEventListener('DOMContentLoaded', initializeForm);