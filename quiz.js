// Quiz functionality - Secure and optimized implementation
class QuizManager {
    constructor() {
        this.currentUser = '';
        this.currentTopic = '';
        this.currentQuestion = 0;
        this.userAnswers = {};
        this.quizState = {};
        this.questionStartTime = 0;
        this.loadingIndicator = null;
        
        this.initializeQuiz();
    }

    initializeQuiz() {
        // Initialize navigation
        this.initNavigation();
        this.initActions();
        
        // Initialize loading indicator
        this.createLoadingIndicator();
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
    }

    initActions() {
        document.addEventListener('click', (event) => {
            const control = event.target.closest?.('[data-quiz-action]');
            if (!control || control.disabled) return;
            switch (control.dataset.quizAction) {
                case 'start': this.startQuiz(); break;
                case 'language': this.selectLanguage(control.dataset.language); break;
                case 'back-start': this.goBackToStart(); break;
                case 'back-languages': this.goBackToLanguages(); break;
                case 'topic': this.loadTopic(control.dataset.topic); break;
                case 'progress': this.showProgress(); break;
                case 'retake': this.retakeQuiz(); break;
                case 'topics': this.goToTopics(); break;
            }
        });
    }

    createLoadingIndicator() {
        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.className = 'loading-indicator hidden';
        this.loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        document.body.appendChild(this.loadingIndicator);
    }

    showLoading() {
        if (this.loadingIndicator) {
            this.loadingIndicator.classList.remove('hidden');
        }
    }

    hideLoading() {
        if (this.loadingIndicator) {
            this.loadingIndicator.classList.add('hidden');
        }
    }

    sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        return input.replace(/[<>\"'&]/g, (match) => {
            const escapeMap = {
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#x27;',
                '&': '&amp;'
            };
            return escapeMap[match];
        }).trim().substring(0, CONFIG.MAX_USERNAME_LENGTH);
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    async startQuiz() {
        const usernameInput = document.getElementById('username');
        const pinInput = document.getElementById('userpin');
        
        if (!usernameInput || !pinInput) return;

        const username = this.sanitizeInput(usernameInput.value);
        const pin = this.sanitizeInput(pinInput.value);
        
        if (!username || !pin) {
            this.showNotification('Please enter both username and PIN!', 'error');
            return;
        }
        
        if (username.length < 3) {
            this.showNotification('Username must be at least 3 characters!', 'error');
            return;
        }
        
        if (!/^[0-9]{4}$/.test(pin)) {
            this.showNotification('PIN must be exactly 4 digits!', 'error');
            return;
        }

        // Create unique user ID from username + PIN
        this.currentUser = username + '_' + pin;
        
        // Hide user setup and show language selection
        this.hideElement('user-setup');
        this.showElement('language-card');
    }

    selectLanguage(language) {
        if (language === 'python') {
            this.hideElement('language-card');
            this.showElement('topics-card');
        } else {
            this.showNotification('This language is not available yet!', 'warning');
        }
    }

    goBackToStart() {
        this.hideElement('language-card');
        this.hideElement('progress-card');
        this.showElement('user-setup');
        
        const usernameInput = document.getElementById('username');
        if (usernameInput) usernameInput.value = '';
        this.currentUser = '';
    }

    goBackToLanguages() {
        this.hideElement('topics-card');
        this.hideElement('progress-card');
        this.showElement('language-card');
        this.closeQuiz();
    }

    async showProgress() {
        if (!this.currentUser) {
            this.showNotification('Please enter your name first!', 'error');
            return;
        }

        this.showLoading();
        await this.loadUserProgress();
        this.hideLoading();
        
        this.hideElement('topics-card');
        this.showElement('progress-card');
    }

    async progressStorageKey() {
        if (!window.crypto?.subtle) {
            throw new Error('Secure local storage is unavailable in this browser.');
        }

        const identity = new TextEncoder().encode(this.currentUser);
        const digest = await window.crypto.subtle.digest('SHA-256', identity);
        const fingerprint = Array.from(new Uint8Array(digest), byte =>
            byte.toString(16).padStart(2, '0')
        ).join('');
        return `portfolio.python-quiz.${fingerprint}`;
    }

    async readLocalProgress() {
        const value = localStorage.getItem(await this.progressStorageKey());
        if (!value) return {};

        const progress = JSON.parse(value);
        return progress && typeof progress === 'object' && !Array.isArray(progress)
            ? progress
            : {};
    }

    async writeLocalProgress(progress) {
        localStorage.setItem(
            await this.progressStorageKey(),
            JSON.stringify(progress)
        );
    }

    async loadUserProgress() {
        try {
            this.quizState = await this.readLocalProgress();
            const progressList = document.getElementById('progress-list');
            if (!progressList) return;

            progressList.innerHTML = '';

            Object.keys(quizData).forEach(topic => {
                const progress = this.quizState[topic];
                const progressItem = this.createProgressItem(topic, progress);
                progressList.appendChild(progressItem);
            });

        } catch (error) {
            console.error("Error loading progress:", error);
            this.showNotification('Could not load progress saved in this browser', 'error');
        }
    }

    createProgressItem(topic, progress) {
        const progressItem = document.createElement('div');
        progressItem.className = 'progress-item';
        
        const score = progress ? progress.score : 0;
        const attempts = progress ? progress.attempts : 0;
        
        progressItem.innerHTML = `
            <div class="topic-progress">
                <i class="fab fa-python"></i>
                <span>${this.sanitizeInput(quizData[topic].title)}</span>
            </div>
            <div>
                <span class="progress-badge">${score}% (${attempts} attempts)</span>
            </div>
        `;
        
        return progressItem;
    }

    updateProgressDisplay() {
        const progressList = document.getElementById('progress-list');
        if (!progressList) return;
        
        progressList.innerHTML = '';
        
        Object.keys(quizData).forEach(topic => {
            const progress = this.quizState[topic];
            const progressItem = this.createProgressItem(topic, progress);
            progressList.appendChild(progressItem);
        });
    }

    loadTopic(topic) {
        if (!quizData[topic]) {
            this.showNotification('Topic not found!', 'error');
            return;
        }

        this.currentTopic = topic;
        this.currentQuestion = 0;
        this.userAnswers = {};
        this.questionStartTime = Date.now();

        this.hideElement('topics-card');
        this.showElement('quiz-container');
        
        const quizTitle = document.getElementById('quiz-title');
        if (quizTitle) {
            quizTitle.innerHTML = `<i class="fab fa-python"></i> ${this.sanitizeInput(quizData[topic].title)}`;
        }

        this.loadQuestion(topic, 0);
    }

    loadQuestion(topic, questionIndex) {
        const questions = quizData[topic].questions;
        const quizContent = document.getElementById('quiz-content');
        
        if (!quizContent || questionIndex >= questions.length) {
            this.showResults(topic);
            return;
        }

        const question = questions[questionIndex];
        
        if (!question || !question.options || question.options.length !== 4) {
            console.error('Question data is incomplete:', question);
            return;
        }

        const difficultyColor = question.difficulty === 'easy' ? '#10b981' : 
                               question.difficulty === 'medium' ? '#f59e0b' : '#ef4444';
        
        // Create question template using DOM methods for better security
        quizContent.innerHTML = '';
        
        const questionContainer = this.createQuestionTemplate(question, questionIndex, questions.length, difficultyColor, topic);
        quizContent.appendChild(questionContainer);

        this.questionStartTime = Date.now();
    }

    createQuestionTemplate(question, questionIndex, totalQuestions, difficultyColor, topic) {
        const container = document.createElement('div');
        
        // Progress header
        const progressHeader = document.createElement('div');
        progressHeader.className = 'question-header';
        
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-fill';
        progressFill.style.width = `${(questionIndex / totalQuestions) * 100}%`;
        progressBar.appendChild(progressFill);
        
        const questionInfo = document.createElement('div');
        questionInfo.className = 'question-info';
        questionInfo.innerHTML = `
            <span class="question-counter">Question ${questionIndex + 1} of ${totalQuestions}</span>
            <span class="difficulty-badge" style="background: ${difficultyColor}20; color: ${difficultyColor}">
                ${question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)}
            </span>
        `;
        
        progressHeader.appendChild(progressBar);
        progressHeader.appendChild(questionInfo);
        
        // Question card
        const questionCard = document.createElement('div');
        questionCard.className = 'question-card';
        
        const questionText = document.createElement('div');
        questionText.className = 'question-text';
        questionText.textContent = question.question;
        
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'options';
        
        question.options.forEach((option, index) => {
            const optionElement = document.createElement('div');
            optionElement.className = 'option';
            optionElement.addEventListener('click', (event) => this.selectOption(topic, questionIndex, index, event));
            
            optionElement.innerHTML = `
                <i class="fas fa-circle"></i>
                <span>${this.sanitizeInput(option)}</span>
            `;
            
            optionsContainer.appendChild(optionElement);
        });
        
        questionCard.appendChild(questionText);
        questionCard.appendChild(optionsContainer);
        
        // Controls
        const controls = document.createElement('div');
        controls.className = 'quiz-controls';
        
        const backBtn = document.createElement('button');
        backBtn.className = 'quiz-btn secondary';
        backBtn.addEventListener('click', () => this.confirmBackToTopics());
        backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Back to Topics';
        
        const prevBtn = document.createElement('button');
        prevBtn.className = 'quiz-btn secondary';
        prevBtn.addEventListener('click', () => this.previousQuestion(topic));
        prevBtn.disabled = questionIndex === 0;
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i> Previous';
        
        const nextBtn = document.createElement('button');
        nextBtn.className = 'quiz-btn';
        nextBtn.id = 'next-btn';
        nextBtn.addEventListener('click', () => this.nextQuestion(topic));
        nextBtn.disabled = true;
        nextBtn.innerHTML = questionIndex === totalQuestions - 1 ? 
            '<i class="fas fa-flag-checkered"></i> Finish Quiz' : 
            'Next <i class="fas fa-chevron-right"></i>';
        
        controls.appendChild(backBtn);
        controls.appendChild(prevBtn);
        controls.appendChild(nextBtn);
        
        container.appendChild(progressHeader);
        container.appendChild(questionCard);
        container.appendChild(controls);
        
        return container;
    }

    selectOption(topic, questionIndex, optionIndex, event) {
        // Remove previous selections
        document.querySelectorAll('.option').forEach(opt => {
            opt.classList.remove('selected');
        });

        // Add selection to clicked option
        if (event && event.currentTarget) {
            event.currentTarget.classList.add('selected');
        }

        // Store answer with timing
        this.userAnswers[questionIndex] = {
            answer: optionIndex,
            timeSpent: Date.now() - this.questionStartTime,
            difficulty: quizData[topic].questions[questionIndex].difficulty
        };

        // Enable next button
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) nextBtn.disabled = false;
    }

    nextQuestion(topic) {
        if (this.currentQuestion < quizData[topic].questions.length - 1) {
            this.currentQuestion++;
            this.loadQuestion(topic, this.currentQuestion);
        } else {
            this.showResults(topic);
        }
    }

    previousQuestion(topic) {
        if (this.currentQuestion > 0) {
            this.currentQuestion--;
            this.loadQuestion(topic, this.currentQuestion);
        }
    }

    async showResults(topic) {
        const questions = quizData[topic].questions;
        let correct = 0;
        let easyCorrect = 0, mediumCorrect = 0, hardCorrect = 0;
        let easyTotal = 0, mediumTotal = 0, hardTotal = 0;

        // Calculate detailed scores
        questions.forEach((question, index) => {
            const userAnswer = this.userAnswers[index];
            if (userAnswer && userAnswer.answer === question.correct) {
                correct++;
                if (question.difficulty === 'easy') easyCorrect++;
                else if (question.difficulty === 'medium') mediumCorrect++;
                else hardCorrect++;
            }
            
            if (question.difficulty === 'easy') easyTotal++;
            else if (question.difficulty === 'medium') mediumTotal++;
            else hardTotal++;
        });

        const score = Math.round((correct / questions.length) * 100);

        // Show results in full screen
        const quizContent = document.getElementById('quiz-content');
        if (quizContent) {
            quizContent.innerHTML = this.createResultsTemplate(score, correct, questions.length, easyCorrect, mediumCorrect, hardCorrect, easyTotal, mediumTotal, hardTotal);
        }

        // Animate score counting
        this.animateScore(score);

        // Show wrong answers review
        this.showWrongAnswers(topic, questions);
        
        // Generate personalized feedback
        this.generateFeedback(score, correct, questions.length, easyCorrect, mediumCorrect, hardCorrect, easyTotal, mediumTotal, hardTotal);

        // Save progress in this browser
        await this.saveQuizProgress(topic, correct, questions.length, score);
    }

    createResultsTemplate(score, correct, total, easyCorrect, mediumCorrect, hardCorrect, easyTotal, mediumTotal, hardTotal) {
        return `
            <div class="score-display">
                <h3><i class="fas fa-trophy"></i> Quiz Complete!</h3>
                <div class="score-circle" id="score-circle">
                    <div class="score-text" id="score-text">0%</div>
                </div>
                
                <div class="detailed-results">
                    <h4>Detailed Performance:</h4>
                    <div class="performance-grid">
                        <div class="performance-item">
                            <span class="level easy">Easy</span>
                            <span>${easyCorrect}/${easyTotal}</span>
                        </div>
                        <div class="performance-item">
                            <span class="level medium">Medium</span>
                            <span>${mediumCorrect}/${mediumTotal}</span>
                        </div>
                        <div class="performance-item">
                            <span class="level hard">Hard</span>
                            <span>${hardCorrect}/${hardTotal}</span>
                        </div>
                    </div>
                </div>

                <div class="quiz-feedback" id="quiz-feedback"></div>
                <div class="wrong-answers" id="wrong-answers"></div>
                <div class="suggestions" id="quiz-suggestions"></div>

                <div class="result-actions">
                    <button class="quiz-btn" data-quiz-action="retake">
                        <i class="fas fa-redo"></i> Retake Quiz
                    </button>
                    <button class="quiz-btn secondary" data-quiz-action="topics">
                        <i class="fas fa-list"></i> Choose Another Topic
                    </button>
                </div>
            </div>
        `;
    }

    animateScore(targetScore) {
        const scoreText = document.getElementById('score-text');
        const scoreCircle = document.getElementById('score-circle');
        if (!scoreText || !scoreCircle) return;

        let currentScore = 0;
        
        const scoreInterval = setInterval(() => {
            currentScore += 2;
            if (currentScore >= targetScore) {
                currentScore = targetScore;
                clearInterval(scoreInterval);
            }
            
            scoreText.textContent = `${currentScore}%`;
            
            const angle = (currentScore / 100) * 360;
            const color = currentScore >= 80 ? 'var(--success-color)' : 
                         currentScore >= 60 ? 'var(--warning-color)' : 'var(--secondary-color)';
            scoreCircle.style.background = `conic-gradient(${color} 0deg, ${color} ${angle}deg, rgba(0,0,0,0.1) ${angle}deg)`;
        }, CONFIG.ANIMATION_DELAY);
    }

    showWrongAnswers(topic, questions) {
        const wrongAnswersElement = document.getElementById('wrong-answers');
        if (!wrongAnswersElement) return;
        
        const wrongAnswers = [];
        
        questions.forEach((question, index) => {
            const userAnswer = this.userAnswers[index];
            if (!userAnswer || userAnswer.answer !== question.correct) {
                wrongAnswers.push({
                    questionNum: index + 1,
                    question: question.question,
                    userAnswer: userAnswer ? question.options[userAnswer.answer] : 'No answer',
                    correctAnswer: question.options[question.correct],
                    explanation: question.explanation
                });
            }
        });
        
        if (wrongAnswers.length === 0) {
            wrongAnswersElement.innerHTML = `
                <div style="text-align: center; padding: 2rem; background: rgba(16, 185, 129, 0.1); border-radius: 12px; border: 2px solid rgba(16, 185, 129, 0.2);">
                    <i class="fas fa-trophy" style="font-size: 2rem; color: var(--success-color); margin-bottom: 1rem;"></i>
                    <h4 style="color: var(--success-color); margin-bottom: 0.5rem;">Perfect Score!</h4>
                    <p>You answered all questions correctly! 🎉</p>
                </div>
            `;
            return;
        }
        
        let wrongAnswersHTML = `
            <div style="margin: 2rem 0;">
                <h4 style="color: var(--secondary-color); margin-bottom: 1rem;">
                    <i class="fas fa-times-circle"></i> Review Incorrect Answers (${wrongAnswers.length})
                </h4>
        `;
        
        wrongAnswers.forEach(wrong => {
            wrongAnswersHTML += `
                <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                    <div style="font-weight: 600; margin-bottom: 0.5rem; color: var(--text-color);">Q${wrong.questionNum}: ${wrong.question}</div>
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: var(--secondary-color); font-weight: 500;">Your answer:</span> ${wrong.userAnswer}
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: var(--success-color); font-weight: 500;">Correct answer:</span> ${wrong.correctAnswer}
                    </div>
                    <div style="font-size: 0.9rem; color: var(--text-color); opacity: 0.8; font-style: italic;">
                        ${wrong.explanation}
                    </div>
                </div>
            `;
        });
        
        wrongAnswersHTML += '</div>';
        wrongAnswersElement.innerHTML = wrongAnswersHTML;
    }

    generateFeedback(score, correct, total, easyCorrect, mediumCorrect, hardCorrect, easyTotal, mediumTotal, hardTotal) {
        let feedback = '';
        let suggestions = '';
        let youtubeMessage = '';

        if (score >= 90) {
            feedback = `Outstanding! You scored ${correct}/${total} correct answers. You're a Python expert!`;
            suggestions = `Excellent mastery across all difficulty levels! You're ready for advanced Python concepts.`;
            youtubeMessage = `Check out my advanced Python tutorials for even more challenging concepts!`;
        } else if (score >= 80) {
            feedback = `Excellent work! You scored ${correct}/${total} correct answers.`;
            suggestions = `You have a solid understanding of this topic.`;
            youtubeMessage = `Keep up the great work! Watch my YouTube tutorials for deeper insights.`;
        } else if (score >= 70) {
            feedback = `Good job! You scored ${correct}/${total} correct answers.`;
            suggestions = `You're doing well, but there's room for improvement in ${hardCorrect < hardTotal/2 ? 'advanced' : 'intermediate'} concepts.`;
            youtubeMessage = `Review my YouTube tutorials to strengthen your understanding!`;
        } else if (score >= 60) {
            feedback = `Keep practicing! You scored ${correct}/${total} correct answers.`;
            suggestions = `Focus on strengthening your fundamentals, especially ${easyCorrect < easyTotal/2 ? 'basic' : 'intermediate'} concepts.`;
            youtubeMessage = `Don't worry! Check out my step-by-step YouTube tutorials to build a strong foundation.`;
        } else {
            feedback = `Don't give up! You scored ${correct}/${total} correct answers.`;
            suggestions = `This topic needs more practice. Start with the basics and work your way up.`;
            youtubeMessage = `I recommend watching my complete Python tutorial series from the beginning!`;
        }

        const feedbackElement = document.getElementById('quiz-feedback');
        const suggestionsElement = document.getElementById('quiz-suggestions');

        if (feedbackElement) {
            feedbackElement.innerHTML = `<p style="font-size: 1.2rem; margin-bottom: 1rem;">${feedback}</p>`;
        }
        
        if (suggestionsElement) {
            suggestionsElement.innerHTML = `
                <h4><i class="fas fa-lightbulb"></i> Personalized Learning Path:</h4>
                <p>${suggestions}</p>
                <p style="margin-top: 1rem;"><strong>${youtubeMessage}</strong></p>
                <div style="text-align: center;">
                    <a href="${CONFIG.YOUTUBE_URL}" target="_blank" class="youtube-link">
                        <i class="fab fa-youtube"></i>
                        Visit My YouTube Channel
                    </a>
                </div>
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(59, 130, 246, 0.05); border-radius: 8px; border-left: 4px solid var(--info-color);">
                    <strong>Study Tips:</strong>
                    <ul style="margin-top: 0.5rem; margin-left: 1rem;">
                        <li>Practice coding daily for at least 30 minutes</li>
                        <li>Build small projects to apply what you learn</li>
                        <li>Join Python communities and forums</li>
                        <li>Review and retake quizzes to track improvement</li>
                    </ul>
                </div>
            `;
        }
    }

    async saveQuizProgress(topic, correct, total, score) {
        try {
            const existingAttempts = this.quizState[topic] ? this.quizState[topic].attempts : 0;
            
            const timeSpent = Object.values(this.userAnswers).reduce((total, answer) => total + (answer.timeSpent || 0), 0);
            const avgTimePerQuestion = total > 0 ? timeSpent / total : 0;

            this.quizState[topic] = {
                correct,
                total,
                score,
                attempts: existingAttempts + 1,
                totalTimeSpent: timeSpent,
                averageTimePerQuestion: avgTimePerQuestion
            };
            await this.writeLocalProgress(this.quizState);

            this.updateProgressDisplay();
            this.showNotification('Progress saved in this browser!', 'success');

        } catch (error) {
            console.error("Error saving progress:", error);
            this.showNotification('Could not save progress in this browser', 'error');
        }
    }

    retakeQuiz() {
        this.currentQuestion = 0;
        this.userAnswers = {};
        this.loadQuestion(this.currentTopic, 0);
    }

    confirmBackToTopics() {
        this.showConfirmation(
            'Exit Quiz?',
            'Are you sure you want to exit this quiz? Your current progress will be lost.',
            () => this.goToTopics()
        );
    }
    
    showConfirmation(title, message, onConfirm) {
        const modal = document.createElement('div');
        modal.className = 'confirmation-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                <p>${message}</p>
                <div class="modal-buttons">
                    <button class="quiz-btn secondary">Cancel</button>
                    <button class="quiz-btn">Confirm</button>
                </div>
            </div>
        `;
        
        const cancelBtn = modal.querySelector('.secondary');
        const confirmBtn = modal.querySelector('.quiz-btn:not(.secondary)');
        
        cancelBtn.addEventListener('click', () => modal.remove());
        confirmBtn.addEventListener('click', () => {
            modal.remove();
            onConfirm();
        });
        
        document.body.appendChild(modal);
    }
    


    goToTopics() {
        this.closeQuiz();
        this.currentTopic = '';
        
        // Just go back to topics selection - keep user logged in
        this.hideElement('progress-card');
        this.showElement('topics-card');
    }

    closeQuiz() {
        this.hideElement('quiz-container');
        this.showElement('topics-card');
    }

    // Utility methods
    hideElement(id) {
        const element = document.getElementById(id);
        if (element) element.classList.add('hidden');
    }

    showElement(id) {
        const element = document.getElementById(id);
        if (element) element.classList.remove('hidden');
    }
}

// Initialize quiz manager when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    window.quizManager = new QuizManager();
});
