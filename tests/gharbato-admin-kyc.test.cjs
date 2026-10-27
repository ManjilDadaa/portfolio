const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function button(attributes = {}) {
    return {
        attributes,
        isConnected: true,
        disabled: true,
        innerHTML: '',
        getAttribute(name) { return this.attributes[name] || null; },
        setAttribute(name, value) { this.attributes[name] = value; }
    };
}

function harness() {
    const objects = new Map();
    const revoked = [];
    const nodes = {
        '#modal-root': { innerHTML: '', querySelector() { return null; } },
        '#modal-confirm': { listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } },
        '#modal-error': { hidden: true, textContent: '' },
        '#modal-reason': { value: '' },
        '#modal-duration': { value: '7' },
        '#view-root': { innerHTML: 'sensitive documents' }
    };
    const document = {
        readyState: 'loading',
        buttons: [],
        querySelector(selector) { return nodes[selector] || null; },
        querySelectorAll(selector) { return selector === '[data-kyc-url]' ? this.buttons : []; },
        addEventListener() {}
    };
    class TestURL extends URL {}
    TestURL.createObjectURL = blob => {
        const url = 'blob:https://manjilbasnet.com.np/document-' + objects.size;
        objects.set(url, blob);
        return url;
    };
    TestURL.revokeObjectURL = url => { revoked.push(url); objects.delete(url); };
    const window = {
        location: { href: 'https://manjilbasnet.com.np/gharbato-admin.html' },
        GHARBATO_ADMIN_CONFIG: { databaseURL: 'https://db.example.test', apiKey: 'test-public-key', adminUid: 'admin' }
    };
    const context = vm.createContext({
        window, document, URL: TestURL, URLSearchParams, Blob, Uint8Array, TextDecoder,
        AbortController, crypto: webcrypto, atob, setTimeout, clearTimeout, setInterval, clearInterval,
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        fetch: async () => { throw new Error('unexpected fetch'); }
    });
    const source = fs.readFileSync(path.join(__dirname, '..', 'gharbato-admin.js'), 'utf8');
    vm.runInContext(source.replace(/\}\(\)\);\s*$/, `
        window.test = { state, hydrateProtectedKycImages, kycDocumentButton, openImage,
            closeModal, signOut, handleAction, loadCore, forceRefreshToken };
    }());`), context);
    window.test.state.session = { idToken: 'test-token', expiresAt: Date.now() + 3600000 };
    return { ...window.test, context, document, nodes, objects, revoked };
}

function mockDatabase(app) {
    const calls = [];
    app.context.fetch = async (rawUrl, options) => {
        const url = new URL(rawUrl);
        assert.equal(url.origin, 'https://db.example.test');
        assert.equal(url.searchParams.get('auth'), 'test-token');
        const call = {
            path: decodeURIComponent(url.pathname).replace(/^\//, '').replace(/\.json$/, ''),
            method: options.method,
            body: options.body ? JSON.parse(options.body) : undefined
        };
        calls.push(call);
        return { ok: true, status: 200, text: async () => JSON.stringify(call.body || { name: 'notification-test-id' }) };
    };
    return calls;
}

async function confirmModal(app) {
    const handler = app.nodes['#modal-confirm'].listeners.click;
    assert.equal(typeof handler, 'function', 'The action must wire a real confirmation handler');
    await handler();
}

async function encryptedDocument() {
    const keyBytes = webcrypto.getRandomValues(new Uint8Array(32));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const clear = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, clear);
    const preview = button({
        'data-kyc-url': 'https://res.cloudinary.com/example/raw/upload/v1/document.jpg',
        'data-kyc-key': Buffer.from(keyBytes).toString('base64'),
        'data-kyc-iv': Buffer.from(iv).toString('base64'),
        'data-kyc-mime': 'image/png',
        'data-alt': 'Front document'
    });
    return { preview, clear, ciphertext };
}

test('AES-GCM document decrypts and its tracked blob opens in the image modal', async () => {
    const app = harness();
    const fixture = await encryptedDocument();
    app.document.buttons = [fixture.preview];
    app.context.fetch = async () => ({ ok: true, arrayBuffer: async () => fixture.ciphertext });
    await app.hydrateProtectedKycImages();
    const src = fixture.preview.getAttribute('data-src');
    assert.equal(fixture.preview.disabled, false);
    assert.deepEqual(new Uint8Array(await app.objects.get(src).arrayBuffer()), fixture.clear);
    app.openImage(src);
    assert.ok(app.nodes['#modal-root'].innerHTML.includes(src));
    app.closeModal();
    app.openImage('blob:https://manjilbasnet.com.np/untracked');
    assert.equal(app.nodes['#modal-root'].innerHTML, '');
    app.openImage('javascript:alert(1)');
    assert.equal(app.nodes['#modal-root'].innerHTML, '');
});

test('encrypted document without its key or IV fails closed', () => {
    const app = harness();
    const html = app.kycDocumentButton('https://res.cloudinary.com/example/raw/upload/v1/doc.jpg', 'Document', '', '');
    assert.match(html, /unavailable/);
    assert.doesNotMatch(html, /<img|data-src/);
});

test('one failed document keeps its own retry without blocking another document', async () => {
    const app = harness();
    const first = await encryptedDocument();
    const second = await encryptedDocument();
    first.preview.attributes['data-kyc-url'] += '?bad';
    app.document.buttons = [first.preview, second.preview];
    app.context.fetch = async url => {
        if (url.endsWith('?bad')) throw new Error('offline');
        return { ok: true, arrayBuffer: async () => second.ciphertext };
    };
    await app.hydrateProtectedKycImages();
    assert.equal(first.preview.getAttribute('data-action'), 'retry-kyc-image');
    assert.equal(first.preview.disabled, false);
    assert.equal(second.preview.getAttribute('data-action'), 'open-kyc-image');
    app.context.fetch = async () => ({ ok: true, arrayBuffer: async () => first.ciphertext });
    await app.handleAction('retry-kyc-image', first.preview);
    assert.equal(first.preview.getAttribute('data-action'), 'open-kyc-image');
});

test('sign-out revokes decrypted images, clears KYC data and prevents late decryption', async () => {
    const app = harness();
    const fixture = await encryptedDocument();
    let completeFetch;
    app.document.buttons = [fixture.preview];
    app.state.kyc = { private: { key: 'sensitive' } };
    app.state.kycObjectUrls.push('blob:https://manjilbasnet.com.np/existing');
    app.context.fetch = () => new Promise(resolve => { completeFetch = resolve; });
    const pending = app.hydrateProtectedKycImages();
    app.signOut('');
    completeFetch({ ok: true, arrayBuffer: async () => fixture.ciphertext });
    await pending;
    assert.equal(app.state.session, null);
    assert.equal(Object.keys(app.state.kyc).length, 0);
    assert.equal(app.nodes['#view-root'].innerHTML, '');
    assert.equal(app.state.kycObjectUrls.length, 0);
    assert.equal(app.objects.size, 0);
    assert.ok(app.revoked.includes('blob:https://manjilbasnet.com.np/existing'));
});

test('a delayed data refresh cannot repopulate private records after sign-out', async () => {
    const app = harness();
    const requests = [];
    app.context.fetch = () => new Promise(resolve => { requests.push(resolve); });
    const pending = app.loadCore();
    await Promise.resolve();
    await Promise.resolve();
    app.signOut('');
    for (const resolve of requests) resolve({ ok: true, status: 200, text: async () => '{"private":{"frontImageKey":"secret"}}' });
    await pending;
    assert.equal(Object.keys(app.state.kyc).length, 0);
    assert.equal(Object.keys(app.state.users).length, 0);
});

test('a delayed token refresh cannot restore a signed-out session', async () => {
    const app = harness();
    let completeFetch;
    app.state.session.refreshToken = 'temporary-test-refresh-token';
    app.context.fetch = () => new Promise(resolve => { completeFetch = resolve; });
    const pending = app.forceRefreshToken();
    app.signOut('');
    completeFetch({ ok: true, json: async () => ({ id_token: 'stale-token', refresh_token: 'stale-refresh-token' }) });
    await assert.rejects(pending, /session ended/);
    assert.equal(app.state.session, null);
});

test('listing approval confirms first, updates status, and notifies owner and marketplace users', async () => {
    const app = harness();
    const calls = mockDatabase(app);
    app.state.properties.listing = { id: 42, title: 'Test home', ownerId: 'owner', status: 'PENDING' };
    app.state.users = { owner: { fullName: 'Owner' }, viewer: { fullName: 'Viewer' } };
    await app.handleAction('approve-listing', button({ 'data-key': 'listing' }));
    assert.equal(calls.length, 0, 'Opening approval must not mutate the database');
    await confirmModal(app);
    assert.deepEqual(calls[0], { path: 'Property/listing', method: 'PATCH', body: { status: 'APPROVED' } });
    assert.equal(app.state.properties.listing.status, 'APPROVED');
    const ownerNotice = calls.find(call => call.path === 'Notifications/owner' && call.body.type === 'listing_approved');
    assert.ok(ownerNotice);
    assert.equal(ownerNotice.method, 'POST');
    assert.equal(ownerNotice.body.actionData, '42');
    const marketplaceNotices = calls.filter(call => call.body.type === 'property');
    assert.deepEqual(marketplaceNotices.map(call => call.path).sort(), ['Notifications/owner', 'Notifications/viewer']);
    assert.ok(marketplaceNotices.every(call => call.body.isRead === false));
});

test('listing rejection requires a reason and sends that reason to its owner', async () => {
    const app = harness();
    const calls = mockDatabase(app);
    app.state.properties.listing = { id: 42, title: 'Test home', ownerId: 'owner', status: 'PENDING' };
    await app.handleAction('reject-listing', button({ 'data-key': 'listing' }));
    await confirmModal(app);
    assert.equal(calls.length, 0);
    assert.match(app.nodes['#modal-error'].textContent, /rejection reason/);
    app.nodes['#modal-reason'].value = '  Please add clear photos.  ';
    await confirmModal(app);
    assert.equal(calls[0].path, 'Property/listing');
    assert.equal(calls[0].body.status, 'REJECTED');
    assert.equal(app.state.properties.listing.status, 'REJECTED');
    assert.equal(calls[1].path, 'Notifications/owner');
    assert.match(calls[1].body.message, /Please add clear photos\./);
    assert.equal(calls[1].body.actionData, '42');
});

test('user suspension writes the chosen duration and activation clears all suspension fields', async () => {
    const app = harness();
    const calls = mockDatabase(app);
    app.state.users.member = { fullName: 'Member', isSuspended: false, suspendedUntil: 0 };
    app.nodes['#modal-duration'].value = '7';
    app.nodes['#modal-reason'].value = 'Policy violation';
    const before = Date.now();
    await app.handleAction('suspend-user', button({ 'data-uid': 'member' }));
    await confirmModal(app);
    const suspension = calls[0];
    assert.equal(suspension.path, 'Users/member');
    assert.equal(suspension.method, 'PATCH');
    assert.equal(suspension.body.isSuspended, true);
    assert.equal(suspension.body.suspensionReason, 'Policy violation');
    assert.ok(suspension.body.suspendedUntil >= before + 7 * 86400000);
    assert.ok(suspension.body.suspendedUntil <= Date.now() + 7 * 86400000);
    assert.equal(app.state.users.member.isSuspended, true);
    await app.handleAction('activate-user', button({ 'data-uid': 'member' }));
    await confirmModal(app);
    assert.deepEqual(calls[1], {
        path: 'Users/member', method: 'PATCH',
        body: { isSuspended: false, suspendedUntil: 0, suspensionReason: '' }
    });
    assert.equal(app.state.users.member.isSuspended, false);
});

test('KYC review records audit fields and notifies the correct owner for approval and rejection', async () => {
    const app = harness();
    const calls = mockDatabase(app);
    app.state.kyc = {
        approve: { userId: 'alice', userName: 'Alice', status: 'Pending' },
        reject: { userId: 'bob', userName: 'Bob', status: 'Pending' }
    };
    await app.handleAction('kyc-approve', button({ 'data-key': 'approve' }));
    await confirmModal(app);
    assert.equal(calls[0].path, 'KycSubmissions/approve');
    assert.equal(calls[0].body.status, 'Approved');
    assert.equal(calls[0].body.reviewedBy, 'Admin');
    assert.ok(calls[0].body.reviewedAt > 0);
    assert.equal(calls[1].path, 'Notifications/alice');
    assert.equal(calls[1].body.title, 'KYC Approved');
    await app.handleAction('kyc-reject', button({ 'data-key': 'reject' }));
    app.nodes['#modal-reason'].value = 'Document is blurry';
    await confirmModal(app);
    assert.equal(calls[2].path, 'KycSubmissions/reject');
    assert.equal(calls[2].body.status, 'Rejected');
    assert.equal(calls[2].body.rejectionReason, 'Document is blurry');
    assert.equal(calls[3].path, 'Notifications/bob');
    assert.match(calls[3].body.message, /Document is blurry/);
    assert.equal(app.state.kyc.approve.status, 'Approved');
    assert.equal(app.state.kyc.reject.status, 'Rejected');
});

test('support send writes the app message schema and clears input only after successful delivery', async () => {
    const app = harness();
    const calls = mockDatabase(app);
    app.state.supportUid = 'member';
    app.nodes['#chat-input'] = { value: '  How can we help?  ' };
    app.nodes['[data-action="send-message"]'] = { disabled: false };
    await app.handleAction('send-message', button());
    assert.equal(calls.length, 1);
    const sent = calls[0];
    assert.match(sent.path, /^support_messages\/member\/m\d+/);
    assert.equal(sent.method, 'PUT');
    assert.equal(sent.body.senderId, 'admin');
    assert.equal(sent.body.admin, true);
    assert.equal(sent.body.isDelivered, false);
    assert.equal(sent.body.isRead, false);
    assert.equal(sent.body.message, 'How can we help?');
    assert.ok(sent.body.timestamp > 0);
    assert.equal(app.nodes['#chat-input'].value, '');
    assert.equal(app.nodes['[data-action="send-message"]'].disabled, false);
    assert.equal(app.state.support.member[sent.body.id].message, 'How can we help?');
    app.nodes['#chat-input'].value = 'Keep this draft';
    app.context.fetch = async () => { throw new Error('offline'); };
    await app.handleAction('send-message', button());
    assert.equal(app.nodes['#chat-input'].value, 'Keep this draft');
    assert.equal(app.nodes['[data-action="send-message"]'].disabled, false);
});
