// Maintenance message function
function showMaintenanceMessage(event) {
    event.preventDefault();
    
    const notification = document.createElement('div');
    notification.textContent = 'Currently in Maintenance Phase';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 2rem;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        z-index: 10000;
        background: #3b82f6;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Portfolio JavaScript - Secure and optimized implementation
class PortfolioManager {
    constructor() {
        this.initializePortfolio();
    }

    initializePortfolio() {
        this.initTypewriter();
        this.initNavigation();
        this.initScrollEffects();
        this.initProjectEffects();
        this.initContactForm();
        this.initNavigationHighlighting();

    }

    initTypewriter() {
        const typewriterElement = document.getElementById('typewriter');
        if (!typewriterElement) return;

        const text = "Manjil Basnet";
        let i = 0;

        const typeWriter = () => {
            if (i < text.length) {
                typewriterElement.textContent += text.charAt(i);
                i++;
                setTimeout(typeWriter, 100);
            }
        };

        typeWriter();
    }

    initNavigation() {
        const navToggle = document.querySelector('.nav-toggle');
        const navMenu = document.querySelector('.nav-menu');

        if (navToggle && navMenu) {
            navToggle.addEventListener('click', () => {
                navMenu.classList.toggle('show');
            });

            document.addEventListener('click', (event) => {
                const isClickInsideNav = navToggle.contains(event.target) || navMenu.contains(event.target);
                if (!isClickInsideNav && navMenu.classList.contains('show')) {
                    navMenu.classList.remove('show');
                }
            });
        }

        // Smooth scrolling for navigation links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                if (navMenu) navMenu.classList.remove('show');
                const target = document.querySelector(anchor.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth'
                    });
                }
            });
        });

        // Home link functionality
        const homeLink = document.getElementById('home-link');
        if (homeLink) {
            homeLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            });
        }
    }

    initScrollEffects() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    if (entry.target.querySelector('.skills-list')) {
                        this.animateSkills(entry.target.querySelector('.skills-list'));
                    }
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('section').forEach(section => {
            observer.observe(section);
        });
    }

    animateSkills(skillsList) {
        if (!skillsList) return;
        
        skillsList.querySelectorAll('li').forEach((skill, index) => {
            skill.style.animationDelay = `${index * 0.1}s`;
            skill.style.animation = `fadeInUp 0.5s ease forwards`;
        });
    }

    initProjectEffects() {
        const projects = document.querySelectorAll('.project');
        projects.forEach(project => {
            project.addEventListener('mouseenter', () => {
                project.style.transform = 'translateY(-10px)';
                project.style.boxShadow = '0 0 20px var(--primary-color)';
            });
            project.addEventListener('mouseleave', () => {
                project.style.transform = 'translateY(0)';
                project.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            });
        });
    }

    sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        return input.trim().substring(0, 5000);
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 2rem;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            z-index: 10000;
            animation: slideIn 0.3s ease;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
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

            // Validate input
            if (!contactData.name || !contactData.email || !contactData.message) {
                this.showNotification('Please fill in all fields', 'error');
                return;
            }

            if (!this.isValidEmail(contactData.email)) {
                this.showNotification('Please enter a valid email address', 'error');
                return;
            }

            const submitButton = form.querySelector('button[type="submit"]');
            const originalButtonText = submitButton?.textContent;
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Sending...';
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
                    console.error("Error saving contact form:", error);
                    this.showNotification('Could not connect to the contact service. Check your connection and try again.', 'error');
                }
            } else {
                this.showNotification('The contact service did not load. Refresh the page and try again.', 'error');
            }

            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText || 'Send Message';
            }
        });
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    initNavigationHighlighting() {
        const sections = document.querySelectorAll('section');
        const navLinks = document.querySelectorAll('nav ul li a');

        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                const sectionHeight = section.clientHeight;
                if (pageYOffset >= sectionTop - sectionHeight / 3) {
                    current = section.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href').slice(1) === current) {
                    link.classList.add('active');
                }
            });
        });
    }


}

// Initialize portfolio when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    new PortfolioManager();
});



// Add CSS for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    .loading-indicator {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 2rem;
        border-radius: 12px;
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 1rem;
        font-weight: 600;
    }
    
    .loading-indicator.hidden {
        display: none;
    }
`;
document.head.appendChild(style);
