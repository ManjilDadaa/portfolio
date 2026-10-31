// Portfolio JavaScript — secure and optimized implementation
function showNotification(message, type = 'info') {
    document.querySelectorAll('.notification').forEach((existing) => existing.remove());

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.setAttribute('role', 'status');
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3500);
}

class PortfolioManager {
    constructor() {
        this.initializePortfolio();
    }

    initializePortfolio() {
        this.initNavigation();
        this.initScrollEffects();
        this.initMaintenanceButtons();
        this.initNoticeButtons();
        this.initContactForm();
        this.initNavigationHighlighting();
    }

    initNavigation() {
        const navToggle = document.querySelector('.nav-toggle');
        const navMenu = document.querySelector('.nav-menu');

        if (navToggle && navMenu) {
            const setExpanded = (expanded) => {
                navToggle.setAttribute('aria-expanded', String(expanded));
                navMenu.classList.toggle('show', expanded);
            };

            navToggle.addEventListener('click', () => {
                setExpanded(!navMenu.classList.contains('show'));
            });

            document.addEventListener('click', (event) => {
                const isClickInsideNav = navToggle.contains(event.target) || navMenu.contains(event.target);
                if (!isClickInsideNav && navMenu.classList.contains('show')) {
                    setExpanded(false);
                }
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && navMenu.classList.contains('show')) {
                    setExpanded(false);
                    navToggle.focus();
                }
            });

            navMenu.querySelectorAll('a').forEach((link) => {
                link.addEventListener('click', () => setExpanded(false));
            });
        }

        // Smooth scrolling for same-page anchors
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                const href = anchor.getAttribute('href');
                if (!href || href === '#') return;

                const target = document.querySelector(href);
                if (!target) return;

                e.preventDefault();
                target.scrollIntoView({
                    behavior: 'smooth'
                });
            });
        });
    }

    initScrollEffects() {
        const sections = document.querySelectorAll('section');

        if (!('IntersectionObserver' in window)) {
            sections.forEach(section => section.classList.add('visible'));
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12 });

        sections.forEach(section => observer.observe(section));
        document.documentElement.classList.add('reveal-ready');
    }

    initMaintenanceButtons() {
        document.querySelectorAll('[data-maintenance]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                this.showNotification('This project is currently in maintenance.', 'info');
            });
        });
    }

    initNoticeButtons() {
        document.querySelectorAll('[data-notice]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                this.showNotification(button.dataset.notice, 'info');
            });
        });
    }

    sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        return input.trim().substring(0, 5000);
    }

    showNotification(message, type = 'info') {
        showNotification(message, type);
    }

    async initContactForm() {
        const form = document.getElementById('contact-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(form);
            const contactData = {
                name: this.sanitizeInput(formData.get('name')).substring(0, 100),
                email: this.sanitizeInput(formData.get('email')).substring(0, 254),
                message: this.sanitizeInput(formData.get('message'))
            };

            if (!contactData.name || !contactData.email || !contactData.message) {
                this.showNotification('Please fill in all fields.', 'error');
                return;
            }

            if (!this.isValidEmail(contactData.email)) {
                this.showNotification('Please enter a valid email address.', 'error');
                return;
            }

            const submitButton = form.querySelector('button[type="submit"]');
            const originalButtonText = submitButton?.textContent;
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Sending…';
            }

            if (window.supabaseService) {
                try {
                    const result = await window.supabaseService.saveContact(contactData);
                    if (result.success) {
                        this.showNotification('Thank you for your message! I will get back to you soon.', 'success');
                        form.reset();
                    } else {
                        console.error('Contact form submission was rejected:', result.error);
                        if (result.error?.code === 'PGRST205' || result.error?.status === 404) {
                            this.showNotification('The contact form is not configured yet. Please try again later.', 'error');
                        } else if (result.error?.status === 401 || result.error?.status === 403) {
                            this.showNotification('The contact form needs a database permission update. Please try again later.', 'error');
                        } else {
                            this.showNotification('Could not send your message. Check your connection and try again.', 'error');
                        }
                    }
                } catch (error) {
                    console.error('Error saving contact form:', error);
                    this.showNotification('Could not connect to the contact service. Check your connection and try again.', 'error');
                }
            } else {
                this.showNotification('The contact service did not load. Refresh the page and try again.', 'error');
            }

            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText || 'Send message';
            }
        });
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    initNavigationHighlighting() {
        const sections = Array.from(document.querySelectorAll('main > section[id]'));
        const navLinks = Array.from(document.querySelectorAll('nav ul li a[href^="#"]'));

        if (!sections.length || !navLinks.length) return;

        const updateActiveLink = () => {
            let current = '';
            const marker = window.pageYOffset + window.innerHeight / 3;

            sections.forEach(section => {
                if (marker >= section.offsetTop) {
                    current = section.id;
                }
            });

            navLinks.forEach(link => {
                const isActive = link.getAttribute('href') === `#${current}`;
                link.classList.toggle('active', isActive);
                if (isActive) {
                    link.setAttribute('aria-current', 'true');
                } else {
                    link.removeAttribute('aria-current');
                }
            });
        };

        let ticking = false;
        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(() => {
                updateActiveLink();
                ticking = false;
            });
        }, { passive: true });

        updateActiveLink();
    }
}

// Kept for older markup that calls it from an inline handler.
function showMaintenanceMessage(event) {
    if (event) event.preventDefault();
    showNotification('This project is currently in maintenance.');
}

document.addEventListener('DOMContentLoaded', () => {
    new PortfolioManager();
});
