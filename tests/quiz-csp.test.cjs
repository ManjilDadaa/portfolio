const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'quiz.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'quiz.html'), 'utf8');

function element() {
    return {
        children: [], style: {}, listeners: {},
        appendChild(child) { this.children.push(child); },
        addEventListener(name, handler) { this.listeners[name] = handler; }
    };
}

function harness() {
    const listeners = {};
    const document = {
        addEventListener(name, handler) { listeners[name] = handler; },
        createElement: element
    };
    const window = {};
    vm.runInNewContext(script + '\nwindow.QuizManager = QuizManager;', {
        document, window, CONFIG: { MAX_USERNAME_LENGTH: 30 }
    });
    const manager = Object.create(window.QuizManager.prototype);
    return { manager, listeners };
}

test('quiz sources contain no inline event attributes or inline script blocks', () => {
    assert.doesNotMatch(html + script, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(script, /\.on[a-z]+\s*=/i);
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
    assert.match(html, /quiz\.js\?v=20261027-1/);
});

test('delegated clicks dispatch every static quiz control and generated results action', () => {
    const { manager, listeners } = harness();
    const calls = [];
    for (const method of ['startQuiz', 'selectLanguage', 'goBackToStart', 'goBackToLanguages', 'loadTopic', 'showProgress', 'retakeQuiz', 'goToTopics']) {
        manager[method] = (...args) => calls.push({ method, args });
    }
    manager.initActions();
    for (const match of html.matchAll(/<button\b([^>]*data-quiz-action="([^"]+)"[^>]*)>/g)) {
        const dataset = { quizAction: match[2] };
        for (const data of match[1].matchAll(/data-(topic|language)="([^"]+)"/g)) dataset[data[1]] = data[2];
        const control = { dataset, disabled: false };
        // A click on the child icon must resolve to its enclosing control.
        listeners.click({ target: { closest: selector => {
            assert.equal(selector, '[data-quiz-action]');
            return control;
        } } });
    }
    assert.equal(calls.filter(call => call.method === 'startQuiz').length, 1);
    assert.deepEqual(calls.find(call => call.method === 'selectLanguage').args, ['python']);
    assert.deepEqual(calls.filter(call => call.method === 'loadTopic').map(call => call.args[0]),
        ['basics', 'datatypes', 'control', 'functions', 'oop', 'files', 'exceptions']);
    assert.equal(calls.filter(call => call.method === 'goBackToStart').length, 1);
    assert.equal(calls.filter(call => call.method === 'goBackToLanguages').length, 1);
    assert.equal(calls.filter(call => call.method === 'showProgress').length, 1);
    const results = manager.createResultsTemplate(80, 8, 10, 4, 3, 1, 4, 4, 2);
    for (const match of results.matchAll(/data-quiz-action="([^"]+)"/g)) {
        listeners.click({ target: { closest: () => ({ dataset: { quizAction: match[1] } }) } });
    }
    assert.equal(calls.filter(call => call.method === 'retakeQuiz').length, 1);
    assert.equal(calls.filter(call => call.method === 'goToTopics').length, 1);
    const before = calls.length;
    listeners.click({ target: { closest: () => ({ dataset: { quizAction: 'start' }, disabled: true }) } });
    listeners.click({ target: { closest: () => ({ dataset: { quizAction: 'unknown' } }) } });
    listeners.click({ target: { closest: () => null } });
    assert.equal(calls.length, before);
});

test('question choice and navigation controls retain their external-script event listeners', () => {
    const { manager } = harness();
    const calls = [];
    manager.selectOption = (...args) => calls.push({ method: 'selectOption', args });
    manager.confirmBackToTopics = () => calls.push({ method: 'confirmBackToTopics' });
    manager.previousQuestion = topic => calls.push({ method: 'previousQuestion', topic });
    manager.nextQuestion = topic => calls.push({ method: 'nextQuestion', topic });
    const question = { difficulty: 'easy', question: 'Question?', options: ['A', 'B'] };
    const root = manager.createQuestionTemplate(question, 1, 3, '#10b981', 'basics');
    const option = root.children[1].children[1].children[0];
    const event = { currentTarget: option };
    option.listeners.click(event);
    assert.equal(calls[0].method, 'selectOption');
    assert.deepEqual(calls[0].args.slice(0, 3), ['basics', 1, 0]);
    assert.equal(calls[0].args[3], event);
    for (const control of root.children[2].children) control.listeners.click();
    assert.equal(calls[1].method, 'confirmBackToTopics');
    assert.equal(calls[2].method, 'previousQuestion');
    assert.equal(calls[2].topic, 'basics');
    assert.equal(calls[3].method, 'nextQuestion');
    assert.equal(calls[3].topic, 'basics');
});
