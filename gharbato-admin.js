(function () {
    'use strict';

    var cfg = window.GHARBATO_ADMIN_CONFIG || {};
    var API_KEY = String(cfg.apiKey || '');
    var DB_URL = String(cfg.databaseURL || '').replace(/\/+$/, '');
    var ADMIN_UID = String(cfg.adminUid || '');
    var STORAGE_KEY = 'gharbato-admin-session-v1';
    var AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
    var TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

    var state = {
        session: null,
        view: 'overview',
        loaded: false,
        busy: false,
        loadError: '',
        properties: {},
        shared: {},
        users: {},
        reports: {},
        userReports: {},
        kyc: {},
        deletionHistory: {},
        support: {},
        presence: {},
        supportUid: null,
        pollTimer: null,
        kycObjectUrls: [],
        kycImageGeneration: 0,
        kycAbortController: null,
        sessionGeneration: 0,
        loadedAt: 0,
        refreshTimer: null,
        globalResults: [],
        globalFocus: -1,
        ui: {
            listingStatus: 'PENDING',
            listingQuery: '',
            listingMarket: '',
            listingSort: 'newest',
            selected: {},
            kycStatus: 'Pending',
            kycQuery: '',
            kycSort: 'newest',
            reportTab: 'listing',
            reportStatus: 'PENDING',
            reportSort: 'newest',
            reportQuery: '',
            userFilter: 'all',
            userQuery: '',
            supportQuery: '',
            deleteTab: 'rejected',
            deleteQuery: '',
            searchQuery: ''
        }
    };

    var memorySession = null;
    var PREF_KEY = 'gharbato-admin-prefs-v1';

    function readPrefs() {
        try {
            var raw = window.localStorage ? window.localStorage.getItem(PREF_KEY) : null;
            var parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function writePrefs(patch) {
        try {
            if (!window.localStorage) return;
            var next = Object.assign(readPrefs(), patch);
            window.localStorage.setItem(PREF_KEY, JSON.stringify(next));
        } catch (error) {
            // Preferences are a convenience; unavailable storage is fine.
        }
    }

    var SUN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    var MOON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13.4A8.6 8.6 0 1 1 10.6 3.5a6.8 6.8 0 0 0 9.9 9.9Z"/></svg>';

    function systemPrefersDark() {
        return typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function currentTheme() {
        var root = document.documentElement;
        var attr = root && root.getAttribute ? root.getAttribute('data-theme') : '';
        return attr === 'dark' ? 'dark' : 'light';
    }

    function updateThemeButton() {
        var dark = currentTheme() === 'dark';
        var buttons = document.querySelectorAll('[data-action="toggle-theme"]');
        for (var i = 0; i < buttons.length; i += 1) {
            buttons[i].innerHTML = dark ? SUN_ICON : MOON_ICON;
            buttons[i].setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
            buttons[i].title = dark ? 'Switch to light theme' : 'Switch to dark theme';
        }
    }

    function applyTheme(theme, persist) {
        var root = document.documentElement;
        if (!root || !root.setAttribute) return;
        var resolved = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light')
            : (theme === 'dark' ? 'dark' : 'light');
        root.setAttribute('data-theme', resolved);
        if (persist !== false) writePrefs({ theme: theme });
        updateThemeButton();
    }

    function toggleTheme() {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    }

    (function restorePrefs() {
        var prefs = readPrefs();
        if (prefs.listingSort) state.ui.listingSort = prefs.listingSort;
        if (prefs.kycSort) state.ui.kycSort = prefs.kycSort;
        if (prefs.userFilter) state.ui.userFilter = prefs.userFilter;
    }());

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function enc(value) {
        return encodeURIComponent(String(value == null ? '' : value));
    }

    function mapValues(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function imageUrl(value) {
        var raw = String(value || '').trim();
        if (!raw) return '';
        try {
            var url = new URL(raw, window.location.href);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
            return url.href;
        } catch (error) {
            return '';
        }
    }

    function imgTag(value, alt, className) {
        var src = imageUrl(value);
        if (!src) return '';
        return '<img class="' + className + '" src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy" referrerpolicy="no-referrer">';
    }

    function firstUrl(value) {
        if (Array.isArray(value)) return value[0] || '';
        if (value && typeof value === 'object') {
            var keys = Object.keys(value);
            return keys.length ? value[keys[0]] : '';
        }
        return '';
    }

    function propertyImage(property) {
        var images = property && property.images ? property.images : {};
        var cover = firstUrl(images.cover);
        if (cover) return cover;
        var keys = Object.keys(images);
        for (var i = 0; i < keys.length; i += 1) {
            var url = firstUrl(images[keys[i]]);
            if (url) return url;
        }
        return '';
    }

    function propertyImages(property) {
        var images = property && property.images ? property.images : {};
        var urls = [];
        Object.keys(images).forEach(function (key) {
            var value = images[key];
            var list = Array.isArray(value) ? value : [value];
            list.forEach(function (url) {
                var raw = String(url || '').trim();
                if (raw && imageUrl(raw) && urls.indexOf(raw) === -1) urls.push(raw);
            });
        });
        return urls;
    }

    function initials(name) {
        var parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
        var text = parts.map(function (part) { return part.charAt(0); }).join('');
        return (text || '?').toUpperCase();
    }

    function avatarHtml(image, name) {
        var src = imageUrl(image);
        if (src) return '<img class="avatar" src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
        return '<span class="avatar-fallback" aria-hidden="true">' + esc(initials(name)) + '</span>';
    }

    function fmtTs(timestamp) {
        if (!timestamp) return '—';
        var date = new Date(Number(timestamp));
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function priceLabel(property) {
        var raw = String(property && property.price != null ? property.price : '').trim();
        if (!raw) return 'Price on request';
        if (/[^\d.,\s]/.test(raw)) return raw;
        var number = Number(raw.replace(/,/g, ''));
        var amount = isFinite(number) ? 'Rs ' + number.toLocaleString('en-IN') : raw;
        var market = String(property.marketType || '').toLowerCase();
        if (market === 'rent') return amount + '/month';
        if (market === 'book') return amount + '/night';
        return amount;
    }

    function ownerOf(property) {
        var user = state.users[property.ownerId] || {};
        return {
            name: user.fullName || user.userName || user.name || property.ownerName || 'Unknown owner',
            email: user.email || property.ownerEmail || '',
            image: user.profileImageUrl || property.ownerImageUrl || '',
            phone: user.phoneNo || ''
        };
    }

    function displayUser(uid) {
        var user = state.users[uid] || {};
        return {
            uid: uid,
            name: user.fullName || user.userName || user.name || 'Unknown user',
            email: user.email || '',
            phone: user.phoneNo || '',
            image: user.profileImageUrl || '',
            suspended: user.isSuspended === true,
            suspendedUntil: Number(user.suspendedUntil || 0),
            suspensionReason: user.suspensionReason || ''
        };
    }

    function propertyList() {
        return Object.keys(state.properties)
            .map(function (key) { return state.properties[key]; })
            .filter(function (property) { return property && typeof property === 'object'; })
            .sort(function (a, b) {
                return Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0);
            });
    }

    function pendingPropertyReports() {
        var grouped = {};
        Object.keys(state.reports).forEach(function (key) {
            var report = state.reports[key];
            if (!report || report.status !== 'PENDING') return;
            var propertyId = String(report.propertyId);
            if (!grouped[propertyId] || Number(report.reportedAt || 0) > Number(grouped[propertyId].reportedAt || 0)) {
                grouped[propertyId] = report;
            }
        });
        return Object.keys(grouped)
            .map(function (propertyId) { return grouped[propertyId]; })
            .sort(function (a, b) { return Number(b.reportedAt || 0) - Number(a.reportedAt || 0); });
    }

    function reportsForProperty(propertyId) {
        return Object.keys(state.reports).filter(function (key) {
            var report = state.reports[key];
            return report && report.status === 'PENDING' && String(report.propertyId) === String(propertyId);
        });
    }

    function groupedUserReports() {
        var grouped = {};
        Object.keys(state.userReports).forEach(function (key) {
            var report = state.userReports[key];
            if (!report || !report.reportedUserId) return;
            if (!grouped[report.reportedUserId]) grouped[report.reportedUserId] = [];
            grouped[report.reportedUserId].push(report);
        });
        return Object.keys(grouped).map(function (uid) {
            var reports = grouped[uid].slice().sort(function (a, b) {
                return Number(b.timestamp || 0) - Number(a.timestamp || 0);
            });
            return { uid: uid, reports: reports, latest: reports[0], user: displayUser(uid) };
        }).sort(function (a, b) {
            return Number(b.latest.timestamp || 0) - Number(a.latest.timestamp || 0);
        });
    }

    function supportThreads() {
        return Object.keys(state.support).map(function (uid) {
            var messages = Object.values(mapValues(state.support[uid]))
                .filter(function (message) { return message && typeof message === 'object'; })
                .sort(function (a, b) { return Number(a.timestamp || 0) - Number(b.timestamp || 0); });
            if (!messages.length) return null;
            return {
                uid: uid,
                messages: messages,
                last: messages[messages.length - 1],
                user: displayUser(uid)
            };
        }).filter(Boolean).sort(function (a, b) {
            return Number(b.last.timestamp || 0) - Number(a.last.timestamp || 0);
        });
    }

    function badge(status) {
        var value = String(status || '').toUpperCase();
        var labels = { APPROVED: 'Approved', PENDING: 'Pending', REJECTED: 'Rejected', SUSPENDED: 'Suspended', ACTIVE: 'Active' };
        var classes = {
            APPROVED: 'badge-approved',
            PENDING: 'badge-pending',
            REJECTED: 'badge-rejected',
            SUSPENDED: 'badge-suspended',
            ACTIVE: 'badge-neutral'
        };
        return '<span class="badge ' + (classes[value] || 'badge-neutral') + '">' + esc(labels[value] || status || 'Unknown') + '</span>';
    }

    function timeAgo(timestamp) {
        var ts = Number(timestamp || 0);
        if (!ts) return '—';
        var diff = Date.now() - ts;
        if (diff < 0) diff = 0;
        var minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return minutes + 'm ago';
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        var days = Math.floor(hours / 24);
        if (days < 30) return days + 'd ago';
        var months = Math.floor(days / 30);
        if (months < 12) return months + 'mo ago';
        return Math.floor(months / 12) + 'y ago';
    }

    function hoursSince(timestamp) {
        var ts = Number(timestamp || 0);
        if (!ts) return 0;
        return (Date.now() - ts) / 3600000;
    }

    function userList() {
        return Object.keys(state.users).map(function (uid) {
            var user = state.users[uid] || {};
            return Object.assign(displayUser(uid), {
                createdAt: Number(user.createdAt || user.joinedAt || 0),
                lastActive: Number(user.lastActive || user.lastLogin || user.lastSeen || 0),
                phone: user.phoneNo || ''
            });
        }).sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
        });
    }

    function listingsForUser(uid) {
        return propertyList().filter(function (property) { return property.ownerId === uid; });
    }

    function reportsForUser(uid) {
        return Object.keys(state.userReports)
            .map(function (key) { return state.userReports[key]; })
            .filter(function (report) { return report && report.reportedUserId === uid; });
    }

    function kycForUser(uid) {
        return Object.keys(state.kyc)
            .map(function (key) { return Object.assign({ _key: key }, state.kyc[key]); })
            .filter(function (submission) { return submission && submission.userId === uid; })
            .sort(function (a, b) { return Number(b.submittedAt || 0) - Number(a.submittedAt || 0); });
    }

    function supportUnread(thread) {
        var messages = thread && thread.messages ? thread.messages : [];
        var lastAdmin = -1;
        messages.forEach(function (message, index) {
            if (message.admin === true || message.senderId === 'admin') lastAdmin = index;
        });
        var unread = 0;
        for (var i = lastAdmin + 1; i < messages.length; i += 1) {
            if (!(messages[i].admin === true || messages[i].senderId === 'admin')) unread += 1;
        }
        return unread;
    }

    function unreadConversations() {
        return supportThreads().filter(function (thread) { return supportUnread(thread) > 0; });
    }

    function setSyncStatus(kind, text) {
        var el = $('#sync-status');
        if (!el) return;
        el.className = 'sync-status' + (kind ? ' is-' + kind : '');
        el.textContent = text;
    }

    function updateSyncStatus() {
        if (!state.session) return;
        if (state.loadError) {
            setSyncStatus('error', 'Refresh failed');
            return;
        }
        if (!state.loadedAt) {
            setSyncStatus('', 'Not loaded');
            return;
        }
        var age = Date.now() - state.loadedAt;
        setSyncStatus(age > 120000 ? 'stale' : 'live', 'Updated ' + timeAgo(state.loadedAt));
    }

    /* -------------------- Session and API -------------------- */

    function jwtPayload(token) {
        try {
            var part = String(token || '').split('.')[1];
            if (!part) return {};
            var base64 = part.replace(/-/g, '+').replace(/_/g, '/');
            var padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
            var bytes = Uint8Array.from(atob(padded), function (ch) { return ch.charCodeAt(0); });
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (error) {
            return {};
        }
    }

    function isAdminToken(token) {
        var payload = jwtPayload(token);
        var uid = String(payload.user_id || payload.sub || '');
        return !!ADMIN_UID && uid === ADMIN_UID;
    }

    function readSession() {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (error) {
            // sessionStorage can be unavailable; fall back to memory.
        }
        return memorySession;
    }

    function writeSession(session) {
        memorySession = session;
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch (error) {
            // Memory fallback is enough for this tab.
        }
    }

    function clearSession() {
        memorySession = null;
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            // Ignore unavailable storage.
        }
    }

    function authError(message) {
        var error = new Error(message);
        error.authFailure = true;
        return error;
    }

    function authMessage(code, fallback) {
        var messages = {
            INVALID_LOGIN_CREDENTIALS: 'Incorrect email or password.',
            EMAIL_NOT_FOUND: 'Incorrect email or password.',
            INVALID_PASSWORD: 'Incorrect email or password.',
            USER_DISABLED: 'This account has been disabled.',
            TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Try again later.',
            API_KEY_INVALID: 'The Firebase web API key is not valid for this project.',
            INVALID_REFRESH_TOKEN: 'The session expired. Sign in again.',
            TOKEN_EXPIRED: 'The session expired. Sign in again.',
            USER_NOT_FOUND: 'The session expired. Sign in again.'
        };
        return messages[code] || fallback || 'Sign in failed.';
    }

    function authCode(payload, fallback) {
        return payload && payload.error && payload.error.message ? payload.error.message : fallback;
    }

    async function signIn(email, password) {
        var response;
        try {
            response = await fetch(AUTH_URL + '?key=' + enc(API_KEY), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
            });
        } catch (error) {
            throw new Error('Network error. Check your connection.');
        }
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) {
            throw new Error(authMessage(authCode(data), 'Sign in failed.'));
        }
        if (String(data.localId || '') !== ADMIN_UID) {
            throw new Error('This account is not authorized for the admin console.');
        }
        var session = {
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
            uid: data.localId,
            email: data.email || email
        };
        writeSession(session);
        state.session = session;
        return session;
    }

    async function forceRefreshToken() {
        var generation = state.sessionGeneration;
        var current = readSession() || state.session;
        if (!current || !current.refreshToken) {
            throw authError('The session expired. Sign in again.');
        }
        var body = new URLSearchParams();
        body.set('grant_type', 'refresh_token');
        body.set('refresh_token', current.refreshToken);
        var response;
        try {
            response = await fetch(TOKEN_URL + '?key=' + enc(API_KEY), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString()
            });
        } catch (error) {
            throw new Error('Network error. Check your connection.');
        }
        var data = await response.json().catch(function () { return {}; });
        if (!state.session || generation !== state.sessionGeneration) {
            throw authError('The session ended. Sign in again.');
        }
        if (!response.ok) {
            clearSession();
            state.session = null;
            throw authError(authMessage(authCode(data), 'The session expired. Sign in again.'));
        }
        if (!isAdminToken(data.id_token)) {
            clearSession();
            state.session = null;
            throw authError('This account is not authorized for the admin console.');
        }
        var session = {
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
            uid: data.user_id || current.uid,
            email: current.email || ''
        };
        writeSession(session);
        state.session = session;
        return session;
    }

    async function getToken() {
        var session = state.session || readSession();
        if (!session) throw authError('The session expired. Sign in again.');
        if (!state.session) state.session = session;
        if (Number(session.expiresAt || 0) - Date.now() < 300000) {
            var fresh = await forceRefreshToken();
            return fresh.idToken;
        }
        return session.idToken;
    }

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function dbRequest(path, options) {
        options = options || {};
        var method = String(options.method || 'GET').toUpperCase();
        var attempt = Number(options.attempt || 0);
        var token = options.token || await getToken();
        var url = DB_URL + '/' + path + '.json?auth=' + enc(token);
        var init = { method: method, cache: 'no-store' };
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
            init.signal = AbortSignal.timeout(20000);
        }
        if (options.body !== undefined) {
            init.headers = { 'Content-Type': 'application/json' };
            init.body = JSON.stringify(options.body);
        }
        var response;
        try {
            response = await fetch(url, init);
        } catch (error) {
            // Reads and idempotent writes survive a flaky connection; POSTs do not retry.
            if (method !== 'POST' && attempt < 2) {
                await delay(350 * (attempt + 1));
                return dbRequest(path, Object.assign({}, options, { attempt: attempt + 1, token: token }));
            }
            throw new Error('Network error. Check your connection.');
        }
        if ((response.status === 429 || response.status >= 500) && method !== 'POST' && attempt < 2) {
            await delay(400 * (attempt + 1));
            return dbRequest(path, Object.assign({}, options, { attempt: attempt + 1, token: token }));
        }
        if (options.onProgress) options.onProgress(response.status);
        if (response.status === 401 && !options.retried) {
            var fresh = await forceRefreshToken();
            var retry = Object.assign({}, options, { token: fresh.idToken, retried: true });
            return dbRequest(path, retry);
        }
        var text = await response.text();
        var data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (error) {
                data = text;
            }
        }
        if (!response.ok) {
            var message = data && typeof data === 'object' && data.error ? String(data.error) : String(data || ('Request failed (' + response.status + ')'));
            if (message === 'Permission denied') {
                throw new Error('Permission denied. This account does not have admin access.');
            }
            throw new Error(message);
        }
        return data;
    }

    function dbPut(path, body) {
        return dbRequest(path, { method: 'PUT', body: body });
    }

    function dbPatch(path, body) {
        return dbRequest(path, { method: 'PATCH', body: body });
    }

    function dbPost(path, body) {
        return dbRequest(path, { method: 'POST', body: body });
    }

    function dbDelete(path) {
        return dbRequest(path, { method: 'DELETE' });
    }

    async function loadCore() {
        var generation = state.sessionGeneration;
        var results = await Promise.all([
            dbRequest('Property'),
            dbRequest('Users'),
            dbRequest('ReportedProperties'),
            dbRequest('user_reports'),
            dbRequest('KycSubmissions'),
            dbRequest('DeletionHistory'),
            dbRequest('SharedProperties')
        ]);
        if (!state.session || generation !== state.sessionGeneration) return;
        var rawProperties = mapValues(results[0]);
        state.properties = {};
        Object.keys(rawProperties).forEach(function (key) {
            state.properties[key] = Object.assign({ _key: key }, rawProperties[key]);
        });
        state.users = mapValues(results[1]);
        state.reports = mapValues(results[2]);
        state.userReports = mapValues(results[3]);
        state.kyc = mapValues(results[4]);
        state.deletionHistory = mapValues(results[5]);
        state.shared = mapValues(results[6]);
    }

    async function loadSupport() {
        var generation = state.sessionGeneration;
        var support = mapValues(await dbRequest('support_messages'));
        if (state.session && generation === state.sessionGeneration) state.support = support;
    }

    async function fetchThread(uid, withPresence) {
        var generation = state.sessionGeneration;
        var thread = mapValues(await dbRequest('support_messages/' + enc(uid)));
        if (!state.session || generation !== state.sessionGeneration) return {};
        state.support[uid] = thread;
        if (withPresence) {
            try {
                var presence = await dbRequest('user_presence/' + enc(uid));
                if (state.session && generation === state.sessionGeneration) state.presence[uid] = presence;
            } catch (error) {
                if (state.session && generation === state.sessionGeneration) state.presence[uid] = null;
            }
        }
        return thread;
    }

    /* -------------------- Notifications -------------------- */

    function createNotification(uid, title, message, type, actionData) {
        if (!uid) return Promise.resolve();
        return dbPost('Notifications/' + enc(uid), {
            title: title,
            message: message,
            type: type,
            timestamp: Date.now(),
            isRead: false,
            imageUrl: '',
            actionData: actionData == null ? '' : String(actionData)
        });
    }

    async function notifyAllUsers(title, message, type, actionData) {
        var uids = Object.keys(state.users);
        var failed = 0;
        for (var i = 0; i < uids.length; i += 10) {
            var chunk = uids.slice(i, i + 10);
            var results = await Promise.allSettled(chunk.map(function (uid) {
                return createNotification(uid, title, message, type, actionData);
            }));
            failed += results.filter(function (result) { return result.status === 'rejected'; }).length;
        }
        return { total: uids.length, failed: failed };
    }

    /* -------------------- Views -------------------- */

    function loadingView() {
        if (state.loadError) {
            return '<div class="banner-error">' + esc(state.loadError) + '</div>' +
                '<div class="loading"><p>Could not load admin data.</p>' +
                '<button type="button" class="btn btn-primary" data-action="refresh">Try again</button></div>';
        }
        return '<div class="loading"><span class="spinner" aria-hidden="true"></span><p>Loading admin data…</p></div>';
    }

    function statButton(view, label, count, className) {
        return '<button type="button" class="stat ' + (className || '') + '" data-action="nav" data-view="' + view + '">' +
            '<span class="stat-value">' + esc(count) + '</span>' +
            '<span class="stat-label">' + esc(label) + '</span></button>';
    }

    function kpi(label, count, view, tone, hint) {
        return '<button type="button" class="stat ' + (tone ? 'is-' + tone : '') + '" data-action="nav" data-view="' + view + '">' +
            '<span class="stat-value">' + esc(count) + '</span>' +
            '<span class="stat-label">' + esc(label) + '</span>' +
            (hint ? '<span class="stat-hint">' + esc(hint) + '</span>' : '') + '</button>';
    }

    function attentionRows() {
        var properties = propertyList();
        var pending = properties.filter(function (property) { return property.status === 'PENDING'; });
        var openReports = pendingPropertyReports();
        var reportedUsers = groupedUserReports();
        var pendingKyc = Object.keys(state.kyc).filter(function (key) {
            return state.kyc[key] && state.kyc[key].status === 'Pending';
        });
        var unread = unreadConversations();
        var suspended = userList().filter(function (user) { return user.suspended; });
        var oldest = pending.length ? pending[pending.length - 1] : null;
        var rows = [];

        if (pending.length) {
            rows.push({
                view: 'listings', tone: '',
                title: pending.length + ' listing' + (pending.length === 1 ? '' : 's') + ' awaiting review',
                detail: oldest ? 'Oldest: ' + (oldest.title || 'Untitled listing') + ' · ' + timeAgo(oldest.createdAt) : '',
                count: pending.length
            });
        }
        if (openReports.length || reportedUsers.length) {
            rows.push({
                view: 'reports', tone: 'is-danger',
                title: (openReports.length + reportedUsers.length) + ' open report' + ((openReports.length + reportedUsers.length) === 1 ? '' : 's'),
                detail: openReports.length + ' on listings · ' + reportedUsers.length + ' on accounts',
                count: openReports.length + reportedUsers.length
            });
        }
        if (pendingKyc.length) {
            rows.push({
                view: 'kyc', tone: '',
                title: pendingKyc.length + ' identity check' + (pendingKyc.length === 1 ? '' : 's') + ' to verify',
                detail: 'Oldest submitted ' + timeAgo(Math.min.apply(null, pendingKyc.map(function (key) {
                    return Number(state.kyc[key].submittedAt || 0) || Date.now();
                }))),
                count: pendingKyc.length
            });
        }
        if (unread.length) {
            rows.push({
                view: 'support', tone: 'is-danger',
                title: unread.length + ' conversation' + (unread.length === 1 ? '' : 's') + ' waiting on a reply',
                detail: 'Latest: ' + (unread[0].user.name || unread[0].uid),
                count: unread.length
            });
        }
        if (suspended.length) {
            rows.push({
                view: 'users', tone: '',
                title: suspended.length + ' suspended account' + (suspended.length === 1 ? '' : 's'),
                detail: 'Review active suspensions and expiries',
                count: suspended.length
            });
        }
        return rows;
    }

    function activityFeed(limit) {
        var items = [];
        propertyList().slice(0, 30).forEach(function (property) {
            items.push({
                ts: Number(property.createdAt || property.updatedAt || 0),
                kind: 'listing',
                title: (property.title || 'Untitled listing') + ' was submitted',
                detail: ownerOf(property).name + ' · ' + priceLabel(property)
            });
        });
        Object.keys(state.kyc).forEach(function (key) {
            var submission = state.kyc[key];
            if (!submission) return;
            items.push({
                ts: Number(submission.reviewedAt || submission.submittedAt || 0),
                kind: 'kyc',
                title: (submission.userName || submission.userEmail || 'A user') + ' — KYC ' + String(submission.status || 'submitted').toLowerCase(),
                detail: 'Identity verification'
            });
        });
        Object.keys(state.reports).forEach(function (key) {
            var report = state.reports[key];
            if (!report) return;
            items.push({
                ts: Number(report.reportedAt || 0),
                kind: 'report',
                title: 'Listing reported: ' + (report.propertyTitle || report.propertyId || 'Listing'),
                detail: report.reportReason || 'Reported by a user'
            });
        });
        Object.keys(state.userReports).forEach(function (key) {
            var report = state.userReports[key];
            if (!report) return;
            items.push({
                ts: Number(report.timestamp || 0),
                kind: 'report',
                title: 'Account reported: ' + (displayUser(report.reportedUserId).name),
                detail: report.reason || 'Reported by a user'
            });
        });
        Object.keys(state.deletionHistory).forEach(function (key) {
            var record = state.deletionHistory[key];
            if (!record) return;
            items.push({
                ts: Number(record.deletedTimestamp || 0),
                kind: 'listing',
                title: 'Listing deleted: ' + (record.propertyTitle || 'Listing'),
                detail: 'by ' + (record.deletedBy || 'Admin')
            });
        });
        return items.filter(function (item) { return item.ts > 0; })
            .sort(function (a, b) { return b.ts - a.ts; })
            .slice(0, limit || 8);
    }

    function overviewView() {
        var properties = propertyList();
        var pending = properties.filter(function (property) { return property.status === 'PENDING'; });
        var approved = properties.filter(function (property) { return property.status === 'APPROVED'; });
        var rows = attentionRows();
        var feed = activityFeed(9);

        var attention = rows.map(function (row) {
            return '<button type="button" class="attention-item" data-action="nav" data-view="' + esc(row.view) + '">' +
                '<span class="attention-dot ' + esc(row.tone) + '"></span>' +
                '<span class="grow"><strong>' + esc(row.title) + '</strong><span>' + esc(row.detail) + '</span></span>' +
                '<span class="attention-count">' + esc(row.count) + ' →</span></button>';
        }).join('');

        var timeline = feed.length ? '<div class="timeline">' + feed.map(function (item) {
            return '<div class="timeline-item" data-kind="' + esc(item.kind) + '">' +
                '<span class="timeline-dot"></span>' +
                '<div class="timeline-body"><strong>' + esc(item.title) + '</strong>' +
                '<span>' + esc(item.detail) + ' · ' + esc(timeAgo(item.ts)) + '</span></div></div>';
        }).join('') + '</div>' : '<p class="muted small">No recent activity.</p>';

        return '<section class="page-head"><div><h1>Overview</h1><p>Everything that needs attention across GharBato.</p></div>' +
            '<div class="filters"><button type="button" class="btn btn-ghost btn-small" data-action="refresh">Refresh data</button></div></section>' +
            '<div class="stat-grid">' +
            kpi('Pending listings', pending.length, 'listings', 'is-warn', pending.length ? 'Oldest ' + timeAgo(pending[pending.length - 1].createdAt) : 'Queue is clear') +
            kpi('Open reports', pendingPropertyReports().length + groupedUserReports().length, 'reports', 'is-danger', 'Listings and accounts') +
            kpi('Pending KYC', Object.keys(state.kyc).filter(function (key) { return state.kyc[key] && state.kyc[key].status === 'Pending'; }).length, 'kyc', '', 'Identity documents') +
            kpi('Unread support', unreadConversations().length, 'support', '', supportThreads().length + ' total conversations') +
            kpi('Live listings', approved.length, 'listings', 'is-good', 'Visible in the app') +
            kpi('Accounts', Object.keys(state.users).length, 'users', '', 'Registered users') +
            '</div>' +
            '<div class="panel-grid">' +
            '<section class="panel"><h2>Needs attention</h2>' +
            (attention ? '<div class="attention-list">' + attention + '</div>' : '<p class="muted small">Nothing is waiting for review. 🎉</p>') +
            '</section>' +
            '<section class="panel"><h2>Recent activity</h2>' + timeline + '</section>' +
            '</div>';
    }

    function propertyDetailsHtml(property) {
        var owner = ownerOf(property);
        var rows = [
            ['Price', priceLabel(property)],
            ['Market', property.marketType || '—'],
            ['Type', property.propertyType || '—'],
            ['Bedrooms', property.bedrooms != null ? property.bedrooms : '—'],
            ['Bathrooms', property.bathrooms != null ? property.bathrooms : '—'],
            ['Area', property.sqft ? property.sqft + ' sq.ft' : '—'],
            ['Floor', property.floor || '—'],
            ['Furnishing', property.furnishing || '—'],
            ['Parking', property.parking === false ? 'No' : 'Yes'],
            ['Pets', property.petsAllowed === true ? 'Allowed' : 'Not allowed'],
            ['Location', property.location || '—'],
            ['Coordinates', property.latitude || property.longitude ? property.latitude + ', ' + property.longitude : '—'],
            ['Owner email', owner.email || '—'],
            ['Submitted', fmtTs(property.createdAt)],
            ['Updated', fmtTs(property.updatedAt)],
            ['Views', String(property.totalViews || 0)]
        ];
        var details = rows.map(function (row) {
            return '<div><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
        }).join('');
        var amenities = Array.isArray(property.amenities) && property.amenities.length
            ? '<p class="description"><strong>Amenities:</strong> ' + esc(property.amenities.join(', ')) + '</p>'
            : '';
        var description = property.description
            ? '<p class="description">' + esc(property.description) + '</p>'
            : '';
        var gallery = propertyImages(property);
        var galleryHtml = gallery.length > 1
            ? '<div class="detail-gallery">' + gallery.map(function (url) {
                return '<button type="button" data-action="open-image" data-src="' + esc(url) + '">' +
                    imgTag(url, property.title || 'Property photo', '') + '</button>';
            }).join('') + '</div>'
            : '';
        return '<div class="details" id="details-' + esc(property._key) + '" hidden>' +
            galleryHtml + '<dl class="detail-grid">' + details + '</dl>' + amenities + description + '</div>';
    }

    function propertyCard(property, key, options) {
        options = options || {};
        var owner = ownerOf(property);
        var image = propertyImage(property);
        var price = priceLabel(property);
        var actions = '';
        if (options.actions && property.status === 'PENDING') {
            actions = '<div class="actions">' +
                '<button type="button" class="btn btn-ghost btn-small" data-action="toggle-details" data-key="' + esc(key) + '">Details</button>' +
                '<button type="button" class="btn btn-primary btn-small" data-action="approve-listing" data-key="' + esc(key) + '">Approve</button>' +
                '<button type="button" class="btn btn-danger btn-small" data-action="reject-listing" data-key="' + esc(key) + '">Reject</button>' +
                '</div>';
        } else {
            actions = '<div class="actions"><button type="button" class="btn btn-ghost btn-small" data-action="toggle-details" data-key="' + esc(key) + '">Details</button></div>';
        }
        var media = image
            ? imgTag(image, property.title || 'Property photo', '')
            : '<span class="placeholder">No photo</span>';
        var selected = !!(options.selectable && state.ui.selected[key]);
        var pick = options.selectable
            ? '<span class="listing-select"><input class="pick" type="checkbox" aria-label="Select ' + esc(property.title || 'listing') + '"' +
              ' data-action="select-listing" data-key="' + esc(key) + '"' + (selected ? ' checked' : '') + '></span>'
            : '';
        var age = options.selectable && hoursSince(property.createdAt) >= 24
            ? '<span class="age-flag">' + esc(Math.floor(hoursSince(property.createdAt) / 24)) + 'd waiting</span>'
            : '';
        return '<article class="listing-card' + (selected ? ' is-selected' : '') + '">' +
            '<div class="listing-media">' + pick + media + '</div>' +
            '<div class="listing-body">' +
            '<div class="row-between"><h3>' + esc(property.title || 'Untitled listing') + age + '</h3>' + (options.status === false ? '' : badge(property.status)) + '</div>' +
            '<p class="meta">' + esc(price) + ' · ' + esc(property.propertyType || 'Property') + ' · ' + esc(property.location || 'No location') + '</p>' +
            '<div class="owner">' + avatarHtml(owner.image, owner.name) +
            '<div class="owner-text"><strong>' + esc(owner.name) + '</strong><span>' + esc(owner.email || 'No email') + '</span></div></div>' +
            actions + propertyDetailsHtml(Object.assign({ _key: key }, property)) +
            '</div></article>';
    }

    function selectedKeys() {
        return Object.keys(state.ui.selected).filter(function (key) { return state.ui.selected[key]; });
    }

    function matchesQuery(property, query) {
        if (!query) return true;
        var owner = ownerOf(property);
        return [property.title, property.location, property.developer, property.propertyType, property.marketType,
            property._key, property.id, owner.name, owner.email]
            .join(' ').toLowerCase().indexOf(query) !== -1;
    }

    function priceValue(property) {
        var number = Number(String(property && property.price != null ? property.price : '').replace(/[^\d.]/g, ''));
        return isFinite(number) ? number : 0;
    }

    function visibleListings() {
        var query = state.ui.listingQuery.trim().toLowerCase();
        var items = propertyList().filter(function (property) {
            return property.status === state.ui.listingStatus;
        }).filter(function (property) {
            if (state.ui.listingMarket && String(property.marketType || '').toLowerCase() !== state.ui.listingMarket) return false;
            return matchesQuery(property, query);
        });
        var sort = state.ui.listingSort;
        items.sort(function (a, b) {
            if (sort === 'oldest') return Number(a.createdAt || 0) - Number(b.createdAt || 0);
            if (sort === 'price') return priceValue(b) - priceValue(a);
            if (sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
            return Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0);
        });
        return items;
    }

    function updateBulkBar() {
        var bar = $('#bulk-bar');
        var count = selectedKeys().length;
        if (bar) {
            bar.hidden = count === 0;
            var label = $('#bulk-count');
            if (label) label.textContent = count + ' selected';
        }
        var all = $('#select-all');
        if (all) {
            var visible = visibleListings();
            all.checked = visible.length > 0 && visible.every(function (property) { return state.ui.selected[property._key]; });
        }
    }

    function renderListingResults() {
        var container = $('#listing-results');
        if (!container) return;
        var items = visibleListings();
        var html = items.map(function (property) {
            var key = property._key;
            return propertyCard(property, key, {
                actions: state.ui.listingStatus === 'PENDING',
                selectable: state.ui.listingStatus === 'PENDING'
            });
        }).join('');
        container.innerHTML = html || '<div class="empty">No ' + esc(state.ui.listingStatus.toLowerCase()) + ' listings match this view.</div>';
        var summary = $('#listing-summary');
        if (summary) summary.textContent = items.length + ' shown';
        updateBulkBar();
    }

    function listingsView() {
        var properties = propertyList();
        var counts = {
            PENDING: properties.filter(function (p) { return p.status === 'PENDING'; }).length,
            APPROVED: properties.filter(function (p) { return p.status === 'APPROVED'; }).length,
            REJECTED: properties.filter(function (p) { return p.status === 'REJECTED'; }).length
        };
        var tabs = ['PENDING', 'APPROVED', 'REJECTED'].map(function (status) {
            var active = state.ui.listingStatus === status ? ' is-active' : '';
            var label = status.charAt(0) + status.slice(1).toLowerCase();
            return '<button type="button" class="seg' + active + '" data-action="listing-status" data-status="' + status + '">' +
                label + '<span class="seg-count">' + counts[status] + '</span></button>';
        }).join('');
        var markets = ['', 'sale', 'rent', 'book'].map(function (value) {
            var label = value ? value.charAt(0).toUpperCase() + value.slice(1) : 'All markets';
            return '<option value="' + value + '"' + (state.ui.listingMarket === value ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
        var sorts = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['price', 'Highest price'], ['title', 'Title A–Z']]
            .map(function (option) {
                return '<option value="' + option[0] + '"' + (state.ui.listingSort === option[0] ? ' selected' : '') + '>' + option[1] + '</option>';
            }).join('');
        var selectable = state.ui.listingStatus === 'PENDING';
        return '<section class="page-head"><div><h1>Listings</h1><p>Review, approve, and track every listing.</p></div>' +
            '<div class="page-actions"><button type="button" class="btn btn-ghost btn-small" data-action="sync-share-links">Sync share links</button></div></section>' +
            '<div class="toolbar"><div class="search"><input id="listing-search" type="search" placeholder="Search title, owner, location…" value="' + esc(state.ui.listingQuery) + '"></div>' +
            '<div class="segmented">' + tabs + '</div></div>' +
            '<div class="toolbar"><div class="filters">' +
            (selectable ? '<label class="filter-label" for="select-all"><input class="pick" type="checkbox" id="select-all" data-action="select-all-listings"> Select all</label>' : '') +
            '<span class="filter-label">Market</span><select id="listing-market" aria-label="Filter by market">' + markets + '</select>' +
            '<span class="filter-label">Sort</span><select id="listing-sort" aria-label="Sort listings">' + sorts + '</select>' +
            '</div><span class="muted small" id="listing-summary"></span></div>' +
            '<div class="bulkbar" id="bulk-bar" hidden><strong id="bulk-count">0 selected</strong><span class="spacer"></span>' +
            '<button type="button" class="btn btn-primary btn-small" data-action="bulk-approve">Approve selected</button>' +
            '<button type="button" class="btn btn-danger btn-small" data-action="bulk-reject">Reject selected</button>' +
            '<button type="button" class="btn btn-ghost btn-small" data-action="bulk-clear">Clear</button></div>' +
            '<div class="stack" id="listing-results"></div>';
    }

    function reportMatches(text, query) {
        return !query || String(text || '').toLowerCase().indexOf(query) !== -1;
    }

    function allListingReportGroups() {
        var grouped = {};
        Object.keys(state.reports).forEach(function (key) {
            var report = state.reports[key];
            if (!report || report.propertyId == null) return;
            var propertyId = String(report.propertyId);
            if (!grouped[propertyId]) grouped[propertyId] = { propertyId: propertyId, reports: [], pending: 0 };
            grouped[propertyId].reports.push(report);
            if (report.status === 'PENDING') grouped[propertyId].pending += 1;
        });
        var groups = Object.keys(grouped).map(function (propertyId) {
            var group = grouped[propertyId];
            group.reports.sort(function (a, b) { return Number(b.reportedAt || 0) - Number(a.reportedAt || 0); });
            group.latest = group.reports[0] || {};
            group.first = group.reports[group.reports.length - 1] || group.latest;
            group.key = findPropertyKeyById(propertyId);
            group.property = group.key ? state.properties[group.key] : null;
            group.title = (group.property && group.property.title) || group.latest.propertyTitle || ('Listing #' + propertyId);
            group.image = (group.property && propertyImage(group.property)) || group.latest.propertyImage || '';
            group.ownerId = (group.property && group.property.ownerId) || group.latest.ownerId || '';
            group.status = group.pending ? 'PENDING' : String(group.latest.status || 'PENDING');
            return group;
        });
        groups.sort(function (a, b) {
            if (state.ui.reportSort === 'reports') {
                return (b.pending - a.pending) || (Number(b.latest.reportedAt || 0) - Number(a.latest.reportedAt || 0));
            }
            return Number(b.latest.reportedAt || 0) - Number(a.latest.reportedAt || 0);
        });
        return groups;
    }

    function visibleReportGroups() {
        var query = state.ui.reportQuery.trim().toLowerCase();
        return allListingReportGroups().filter(function (group) {
            if (state.ui.reportStatus === 'PENDING' && group.pending === 0) return false;
            if (state.ui.reportStatus === 'RESOLVED' && group.pending > 0) return false;
            if (!query) return true;
            return reportMatches([group.title, group.propertyId,
                displayUser(group.ownerId).name,
                group.reports.map(function (report) {
                    return [report.reportReason, report.reportDetails, report.reportedByName].join(' ');
                }).join(' ')
            ].join(' '), query);
        });
    }

    function reportGroupCard(group) {
        var report = group.latest;
        var image = imageUrl(group.image);
        var ownerName = group.ownerId ? displayUser(group.ownerId).name : (report.ownerName || 'Unknown owner');
        var isOpen = group.pending > 0;
        var reasons = group.reports.map(function (item) {
            var status = String(item.status || 'PENDING');
            var suffix = status === 'PENDING' ? '' : (status === 'DISMISSED' ? ' · Dismissed' : ' · Reviewed');
            return '<div class="report-reason">' +
                '<div class="report-reason-head"><strong>' + esc(item.reportReason || 'No reason provided') + '</strong>' +
                '<time>' + esc(timeAgo(item.reportedAt)) + '</time></div>' +
                (item.reportDetails ? '<p>' + esc(item.reportDetails) + '</p>' : '') +
                '<div class="report-by">' + esc(item.reportedByName || 'Anonymous') +
                '<span class="dot"></span>' + esc(fmtTs(item.reportedAt)) + esc(suffix) + '</div></div>';
        }).join('');
        var actions = '<div class="report-actions">' +
            (group.key ? '<button type="button" class="btn btn-ghost btn-small" data-action="view-report-listing" data-key="' + esc(group.key) + '">View listing</button>' : '') +
            (group.ownerId ? '<button type="button" class="btn btn-ghost btn-small" data-action="view-report-user" data-uid="' + esc(group.ownerId) + '">Owner profile</button>' : '') +
            (isOpen
                ? '<button type="button" class="btn btn-ghost btn-small" data-action="keep-report" data-property="' + esc(group.propertyId) + '">Keep listing</button>' +
                  '<button type="button" class="btn btn-danger btn-small" data-action="remove-report" data-property="' + esc(group.propertyId) + '">Remove listing</button>'
                : '') +
            '</div>';
        return '<article class="report-card' + (isOpen ? '' : ' is-resolved') + '">' +
            '<div class="report-thumb">' +
            (image ? imgTag(image, group.title, '') : '<span class="placeholder">No photo</span>') +
            (group.reports.length > 1 ? '<span class="report-count">' + group.reports.length + ' reports</span>' : '') +
            '</div>' +
            '<div class="report-body">' +
            '<div class="report-head"><div class="grow"><h3>' + esc(group.title) + '</h3>' +
            '<p class="report-sub">Owner <strong>' + esc(ownerName) + '</strong> · first reported ' + esc(timeAgo(group.first.reportedAt)) +
            (group.reports.length > 1 ? ' · latest ' + esc(timeAgo(report.reportedAt)) : '') + '</p></div>' +
            (isOpen ? '<span class="chip is-warn">' + group.pending + ' open</span>' : '<span class="chip">Resolved</span>') +
            '</div>' +
            '<div class="report-reasons">' + reasons + '</div>' +
            actions + '</div></article>';
    }

    function openReportListing(key) {
        var property = state.properties[key];
        if (!property) {
            toast('This listing is no longer in the database.', 'error');
            return;
        }
        var owner = ownerOf(property);
        var cover = imageUrl(propertyImage(property));
        var body = '<div class="profile-head">' +
            (cover ? '<img class="avatar" style="width:52px;height:52px;flex-basis:52px;border-radius:12px;object-fit:cover" src="' + esc(cover) + '" alt="">' : '') +
            '<div class="grow"><strong>' + esc(property.title || 'Untitled listing') + '</strong>' +
            '<span>' + esc(priceLabel(property)) + ' · ' + esc(property.location || 'No location') + '</span>' +
            '<span>Owner: ' + esc(owner.name) + (owner.email ? ' · ' + esc(owner.email) : '') + '</span></div>' +
            badge(property.status) + '</div>' +
            propertyDetailsHtml(property).replace(' hidden>', '>');
        openModal({
            title: 'Reported listing',
            bodyHtml: body,
            confirmLabel: 'Close',
            hideCancel: true,
            onConfirm: function () { }
        });
    }

    function reportResultsHtml() {
        var query = state.ui.reportQuery.trim().toLowerCase();
        if (state.ui.reportTab === 'user') {
            var userGroups = groupedUserReports().filter(function (group) {
                return reportMatches([group.user.name, group.user.email, group.uid,
                    group.reports.map(function (report) { return report.reason; }).join(' ')].join(' '), query);
            });
            return userGroups.length ? '<div class="stack">' + userGroups.map(userReportCard).join('') + '</div>'
                : '<div class="empty">No reported accounts match this view.</div>';
        }
        var groups = visibleReportGroups();
        if (!groups.length) {
            var message = query ? 'No reports match that search.'
                : (state.ui.reportStatus === 'PENDING' ? 'No open listing reports. Everything is reviewed.'
                    : 'No listing reports in this view.');
            return '<div class="empty">' + esc(message) + '</div>';
        }
        return '<div class="stack">' + groups.map(reportGroupCard).join('') + '</div>';
    }

    function renderReportResults() {
        var container = $('#report-results');
        if (container) container.innerHTML = reportResultsHtml();
        var summary = $('#report-summary');
        if (summary) summary.innerHTML = reportSummaryHtml();
    }

    function reportSummaryHtml() {
        var groups = allListingReportGroups();
        var openReports = groups.reduce(function (sum, group) { return sum + group.pending; }, 0);
        var openListings = groups.filter(function (group) { return group.pending > 0; }).length;
        var resolved = groups.length - openListings;
        var accounts = groupedUserReports();
        return '<span class="chip' + (openReports ? ' is-warn' : '') + '">' + openReports + ' open report' + (openReports === 1 ? '' : 's') + '</span>' +
            '<span class="chip">' + openListings + ' listing' + (openListings === 1 ? '' : 's') + ' affected</span>' +
            '<span class="chip is-good">' + resolved + ' reviewed</span>' +
            '<span class="chip' + (accounts.length ? ' is-danger' : '') + '">' + accounts.length + ' reported account' + (accounts.length === 1 ? '' : 's') + '</span>';
    }

    function reportsView() {
        var tab = state.ui.reportTab === 'user' ? 'user' : 'listing';
        var groups = allListingReportGroups();
        var openListings = groups.filter(function (group) { return group.pending > 0; }).length;
        var openReports = groups.reduce(function (sum, group) { return sum + group.pending; }, 0);
        var accounts = groupedUserReports();
        var statusTabs = [['PENDING', 'Open'], ['RESOLVED', 'Resolved'], ['ALL', 'All']].map(function (option) {
            return '<button type="button" class="seg' + (state.ui.reportStatus === option[0] ? ' is-active' : '') + '" data-action="report-status" data-status="' + option[0] + '">' + option[1] + '</button>';
        }).join('');
        return '<section class="page-head"><div><h1>Reports</h1><p>Review reports against listings and accounts, then keep, remove or resolve them.</p></div>' +
            '<button type="button" class="btn btn-ghost btn-small" data-action="refresh">Refresh</button></section>' +
            '<div class="report-summary" id="report-summary">' + reportSummaryHtml() + '</div>' +
            '<div class="toolbar"><div class="segmented">' +
            '<button type="button" class="seg' + (tab === 'listing' ? ' is-active' : '') + '" data-action="report-tab" data-tab="listing">Listings<span class="seg-count">' + openListings + '</span></button>' +
            '<button type="button" class="seg' + (tab === 'user' ? ' is-active' : '') + '" data-action="report-tab" data-tab="user">Accounts<span class="seg-count">' + accounts.length + '</span></button>' +
            '</div><div class="search"><input id="report-search" type="search" placeholder="Search title, owner, reason, reporter…" value="' + esc(state.ui.reportQuery) + '"></div></div>' +
            (tab === 'listing'
                ? '<div class="toolbar"><div class="report-filters"><div class="segmented">' + statusTabs + '</div>' +
                  '<select id="report-sort" aria-label="Sort reports">' +
                  '<option value="newest"' + (state.ui.reportSort === 'newest' ? ' selected' : '') + '>Newest first</option>' +
                  '<option value="reports"' + (state.ui.reportSort === 'reports' ? ' selected' : '') + '>Most reported</option></select></div>' +
                  '<span class="muted small">' + openReports + ' open report' + (openReports === 1 ? '' : 's') + ' across ' + openListings + ' listing' + (openListings === 1 ? '' : 's') + '</span></div>'
                : '') +
            '<div id="report-results">' + reportResultsHtml() + '</div>';
    }

    function userMatchesFilter(user, filter) {
        if (filter === 'suspended') return user.suspended;
        if (filter === 'reported') return reportsForUser(user.uid).length > 0;
        if (filter === 'verified') return kycForUser(user.uid).some(function (submission) { return submission.status === 'Approved'; });
        return true;
    }

    function usersView() {
        var all = userList();
        var query = state.ui.userQuery.trim().toLowerCase();
        var filter = state.ui.userFilter;
        var visible = all.filter(function (user) {
            if (!userMatchesFilter(user, filter)) return false;
            if (!query) return true;
            return [user.name, user.email, user.uid, user.phone].join(' ').toLowerCase().indexOf(query) !== -1;
        });
        var counts = {
            all: all.length,
            suspended: all.filter(function (user) { return user.suspended; }).length,
            reported: all.filter(function (user) { return reportsForUser(user.uid).length > 0; }).length,
            verified: all.filter(function (user) {
                return kycForUser(user.uid).some(function (submission) { return submission.status === 'Approved'; });
            }).length
        };
        var tabs = [['all', 'All'], ['suspended', 'Suspended'], ['reported', 'Reported'], ['verified', 'KYC verified']]
            .map(function (option) {
                return '<button type="button" class="seg' + (filter === option[0] ? ' is-active' : '') + '" data-action="user-filter" data-filter="' + option[0] + '">' +
                    option[1] + '<span class="seg-count">' + counts[option[0]] + '</span></button>';
            }).join('');
        var rows = visible.map(function (user) {
            var listings = listingsForUser(user.uid);
            var kyc = kycForUser(user.uid)[0];
            var reports = reportsForUser(user.uid).length;
            var status = user.suspended
                ? '<span class="chip is-danger">Suspended</span>'
                : '<span class="chip is-good">Active</span>';
            var kycChip = kyc
                ? '<span class="chip ' + (kyc.status === 'Approved' ? 'is-good' : kyc.status === 'Rejected' ? 'is-danger' : 'is-warn') + '">' + esc(kyc.status || 'Pending') + '</span>'
                : '<span class="chip">None</span>';
            return '<tr>' +
                '<td><div class="table-user">' + avatarHtml(user.image, user.name) +
                '<div class="grow"><strong>' + esc(user.name) + '</strong><span>' + esc(user.email || user.uid) + '</span></div></div></td>' +
                '<td>' + status + (reports ? ' <span class="chip is-warn">' + reports + ' report' + (reports === 1 ? '' : 's') + '</span>' : '') + '</td>' +
                '<td>' + listings.length + ' <span class="muted small">(' + listings.filter(function (property) { return property.status === 'APPROVED'; }).length + ' live)</span></td>' +
                '<td>' + kycChip + '</td>' +
                '<td class="row-actions"><button type="button" class="btn btn-ghost btn-small" data-action="open-user" data-uid="' + esc(user.uid) + '">View</button>' +
                (user.suspended
                    ? '<button type="button" class="btn btn-ghost btn-small" data-action="activate-user" data-uid="' + esc(user.uid) + '">Activate</button>'
                    : '<button type="button" class="btn btn-danger btn-small" data-action="suspend-user" data-uid="' + esc(user.uid) + '">Suspend</button>') +
                '</td></tr>';
        }).join('');
        var table = visible.length
            ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Account</th><th>Status</th><th>Listings</th><th>KYC</th><th style="text-align:right">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<div class="empty">No accounts match this view.</div>';
        return '<section class="page-head"><div><h1>Users</h1><p>Every registered account, its listings, verification and moderation state.</p></div></section>' +
            '<div class="toolbar"><div class="segmented">' + tabs + '</div>' +
            '<div class="search"><input id="user-search" type="search" placeholder="Search name, email, phone, UID…" value="' + esc(state.ui.userQuery) + '"></div></div>' +
            '<p class="muted small" style="margin-bottom:10px">Showing ' + visible.length + ' of ' + all.length + ' accounts</p>' +
            table;
    }

    function openUserProfile(uid) {
        var user = displayUser(uid);
        var listings = listingsForUser(uid);
        var reports = reportsForUser(uid);
        var kyc = kycForUser(uid)[0];
        var live = listings.filter(function (property) { return property.status === 'APPROVED'; }).length;
        var pending = listings.filter(function (property) { return property.status === 'PENDING'; }).length;
        var listingRows = listings.slice(0, 8).map(function (property) {
            return '<div class="profile-row"><div class="grow"><strong>' + esc(property.title || 'Untitled listing') + '</strong>' +
                '<span>' + esc(priceLabel(property)) + ' · ' + esc(property.location || 'No location') + '</span></div>' +
                badge(property.status) + '</div>';
        }).join('');
        var body = '<div class="profile-head">' + avatarHtml(user.image, user.name) +
            '<div class="grow"><strong>' + esc(user.name) + '</strong><span>' + esc(user.email || 'No email') + '</span>' +
            '<span>' + esc(user.phone || 'No phone') + '</span></div>' +
            (user.suspended ? badge('SUSPENDED') : badge('ACTIVE')) + '</div>' +
            '<div class="profile-stats">' +
            '<div class="profile-stat"><strong>' + listings.length + '</strong><span>Listings</span></div>' +
            '<div class="profile-stat"><strong>' + live + '</strong><span>Live</span></div>' +
            '<div class="profile-stat"><strong>' + pending + '</strong><span>In review</span></div>' +
            '<div class="profile-stat"><strong>' + reports.length + '</strong><span>Reports</span></div>' +
            '</div>' +
            '<p class="muted small" style="margin-bottom:8px">UID <code>' + esc(uid) + '</code></p>' +
            (kyc ? '<p class="muted small" style="margin-bottom:10px">KYC: ' + esc(kyc.status || 'Pending') + ' · ' + esc(kyc.documentType || 'Document') + '</p>' : '') +
            (user.suspended ? '<div class="reason-box"><strong>Suspension</strong>' + esc(user.suspensionReason || 'No reason recorded') +
                '<br>Until ' + esc(fmtTs(user.suspendedUntil)) + '</div>' : '') +
            (reports.length ? '<div class="reason-box"><strong>Latest report</strong>' + esc(reports[0].reason || 'No reason') + '</div>' : '') +
            '<div class="toolbar-title" style="margin:14px 0 8px"><h2>Listings</h2><span>' + listings.length + ' total</span></div>' +
            (listingRows ? '<div class="profile-list">' + listingRows + '</div>' : '<p class="muted small">This account has no listings.</p>') +
            '<div class="actions" style="margin-top:16px">' +
            '<button type="button" class="btn btn-ghost btn-small" data-action="open-thread" data-uid="' + esc(uid) + '">Message</button>' +
            (user.suspended
                ? '<button type="button" class="btn btn-ghost btn-small" data-action="activate-user" data-uid="' + esc(uid) + '">Activate account</button>'
                : '<button type="button" class="btn btn-danger btn-small" data-action="suspend-user" data-uid="' + esc(uid) + '">Suspend account</button>') +
            '<button type="button" class="btn btn-ghost btn-small" data-action="notify-user" data-uid="' + esc(uid) + '">Send notification</button>' +
            '</div>';
        openModal({
            title: 'Account',
            bodyHtml: body,
            confirmLabel: 'Close',
            hideCancel: true,
            onConfirm: function () { }
        });
    }

    function userReportCard(group) {
        var user = group.user;
        var statusBadge = user.suspended ? badge('SUSPENDED') : badge('ACTIVE');
        var suspension = user.suspended
            ? '<p class="meta">Until ' + esc(fmtTs(user.suspendedUntil)) + (user.suspensionReason ? ' · ' + esc(user.suspensionReason) : '') + '</p>'
            : '';
        var reasons = group.reports.map(function (report) {
            return '<div class="report-reason">' +
                '<div class="report-reason-head"><strong>' + esc(report.reason || 'No reason provided') + '</strong>' +
                '<time>' + esc(timeAgo(report.timestamp)) + '</time></div>' +
                '<div class="report-by">By ' + esc(displayUser(report.reporterId).name) +
                '<span class="dot"></span>' + esc(fmtTs(report.timestamp)) + '</div></div>';
        }).join('');
        return '<article class="listing-card" style="grid-template-columns:1fr">' +
            '<div class="listing-body">' +
            '<div class="row-between"><div class="owner" style="margin-top:0">' + avatarHtml(user.image, user.name) +
            '<div class="owner-text"><strong>' + esc(user.name) + '</strong><span>' + esc(user.email || user.uid) + '</span></div></div>' +
            statusBadge + '</div>' +
            '<p class="meta">' + group.reports.length + ' report' + (group.reports.length === 1 ? '' : 's') + ' · latest ' + esc(timeAgo(group.latest.timestamp)) + '</p>' +
            '<div class="report-account-reports">' + reasons + '</div>' +
            suspension +
            '<div class="actions">' +
            '<button type="button" class="btn btn-ghost btn-small" data-action="view-report-user" data-uid="' + esc(group.uid) + '">View account</button>' +
            (user.suspended
                ? '<button type="button" class="btn btn-ghost btn-small" data-action="activate-user" data-uid="' + esc(group.uid) + '">Activate</button>'
                : '<button type="button" class="btn btn-danger btn-small" data-action="suspend-user" data-uid="' + esc(group.uid) + '">Suspend</button>') +
            '<button type="button" class="btn btn-ghost btn-small" data-action="resolve-user" data-uid="' + esc(group.uid) + '">Dismiss reports</button>' +
            '</div></div></article>';
    }

    function kycCard(key, submission) {
        var front = imageUrl(submission.frontImageUrl);
        var back = imageUrl(submission.backImageUrl);
        var docs = '';
        if (front || back) {
            docs = '<div class="doc-pair">' +
                (front ? kycDocumentButton(front, 'Front of document', submission.frontImageKey, submission.frontImageIv, submission.frontImageMimeType) : '') +
                (back ? kycDocumentButton(back, 'Back of document', submission.backImageKey, submission.backImageIv, submission.backImageMimeType) : '') +
                '</div>';
        }
        var review = '';
        if (submission.status === 'Rejected' && submission.rejectionReason) {
            review = '<div class="reason-box"><strong>Rejection reason</strong>' + esc(submission.rejectionReason) + '</div>';
        } else if (submission.status === 'Approved') {
            review = '<p class="meta">Reviewed ' + esc(fmtTs(submission.reviewedAt)) + ' by ' + esc(submission.reviewedBy || 'Admin') + '</p>';
        }
        var actions = '';
        if (submission.status === 'Pending') {
            actions = '<div class="actions">' +
                '<button type="button" class="btn btn-primary btn-small" data-action="kyc-approve" data-key="' + esc(key) + '">Approve</button>' +
                '<button type="button" class="btn btn-danger btn-small" data-action="kyc-reject" data-key="' + esc(key) + '">Reject</button>' +
                '</div>';
        }
        return '<article class="listing-card" style="grid-template-columns:1fr">' +
            '<div class="listing-body">' +
            '<div class="row-between"><h3>' + esc(submission.userName || 'Unknown user') + '</h3>' + badge(submission.status === 'Approved' ? 'APPROVED' : submission.status === 'Rejected' ? 'REJECTED' : 'PENDING') + '</div>' +
            '<p class="meta">' + esc(submission.userEmail || '') + ' · ' + esc(submission.documentType || 'Document') + ' · Submitted ' + esc(fmtTs(submission.submittedAt)) + '</p>' +
            docs + review + actions +
            '</div></article>';
    }

    function isProtectedKycUrl(url) {
        return String(url || '').indexOf('/raw/upload/') !== -1;
    }

    function kycDocumentButton(url, alt, key, iv, mimeType) {
        if (!isProtectedKycUrl(url)) {
            return '<button type="button" data-action="open-image" data-src="' + esc(url) + '">' +
                imgTag(url, alt, '') + '</button>';
        }
        if (!key || !iv) return '<span class="muted small">Protected document unavailable.</span>';
        try {
            var assetUrl = new URL(url);
            if (assetUrl.protocol !== 'https:' || assetUrl.hostname !== 'res.cloudinary.com') {
                return '<span class="muted small">Protected document unavailable.</span>';
            }
        } catch (error) {
            return '<span class="muted small">Protected document unavailable.</span>';
        }
        return '<button type="button" data-action="open-kyc-image" data-kyc-url="' + esc(url) +
            '" data-kyc-key="' + esc(key) + '" data-kyc-iv="' + esc(iv) +
            '" data-kyc-mime="' + esc(mimeType || 'image/jpeg') + '" data-alt="' + esc(alt) +
            '" disabled><span class="muted small">Decrypting secure document…</span></button>';
    }

    function clearKycObjectUrls() {
        state.kycImageGeneration += 1;
        if (state.kycAbortController) state.kycAbortController.abort();
        state.kycAbortController = null;
        state.kycObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
        state.kycObjectUrls = [];
    }

    async function hydrateProtectedKycImages() {
        var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-kyc-url]'));
        if (!buttons.length) return;
        state.kycAbortController = new AbortController();
        var generation = state.kycImageGeneration;
        var signal = state.kycAbortController.signal;
        await Promise.all(buttons.map(function (button) {
            return loadProtectedKycImage(button, generation, signal);
        }));
    }

    async function loadProtectedKycImage(button, generation, signal) {
        function current() {
            return !signal.aborted && state.session && generation === state.kycImageGeneration && button.isConnected;
        }
        if (!current()) return;
        button.disabled = true;
        button.innerHTML = '<span class="muted small">Decrypting secure document…</span>';
        try {
            var response = await fetch(button.getAttribute('data-kyc-url'), { cache: 'no-store', signal: signal });
            if (!response.ok) throw new Error('Could not load a protected KYC document.');
            function decode(value) {
                return Uint8Array.from(atob(value), function (character) { return character.charCodeAt(0); });
            }
            var key = await crypto.subtle.importKey(
                'raw', decode(button.getAttribute('data-kyc-key')), { name: 'AES-GCM' }, false, ['decrypt']
            );
            var clear = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: decode(button.getAttribute('data-kyc-iv')), tagLength: 128 },
                key,
                await response.arrayBuffer()
            );
            if (!current()) return;
            var objectUrl = URL.createObjectURL(new Blob([clear], {
                type: button.getAttribute('data-kyc-mime') || 'image/jpeg'
            }));
            state.kycObjectUrls.push(objectUrl);
            button.setAttribute('data-src', objectUrl);
            button.setAttribute('data-action', 'open-kyc-image');
            button.disabled = false;
            button.innerHTML = '<img src="' + esc(objectUrl) + '" alt="' + esc(button.getAttribute('data-alt') || 'KYC document') + '">';
        } catch (error) {
            if (!current()) return;
            button.setAttribute('data-action', 'retry-kyc-image');
            button.disabled = false;
            button.innerHTML = '<span class="muted small">Document could not be opened. Click to retry.</span>';
        }
    }

    function kycView() {
        var submissions = Object.keys(state.kyc).map(function (key) {
            return { key: key, value: state.kyc[key] };
        }).filter(function (item) { return item.value && typeof item.value === 'object'; })
            .sort(function (a, b) { return Number(b.value.submittedAt || 0) - Number(a.value.submittedAt || 0); });
        var counts = { Pending: 0, Approved: 0, Rejected: 0 };
        submissions.forEach(function (item) { if (counts[item.value.status] != null) counts[item.value.status] += 1; });
        var tabs = ['Pending', 'Approved', 'Rejected'].map(function (status) {
            var active = state.ui.kycStatus === status ? ' is-active' : '';
            return '<button type="button" class="seg' + active + '" data-action="kyc-status" data-status="' + status + '">' +
                status + '<span class="seg-count">' + counts[status] + '</span></button>';
        }).join('');
        return '<section class="page-head"><div><h1>KYC verification</h1><p>Review identity documents submitted by users.</p></div></section>' +
            '<div class="toolbar"><div class="segmented">' + tabs + '</div>' +
            '<div class="filters"><div class="search"><input id="kyc-search" type="search" placeholder="Search name, email, document…" value="' + esc(state.ui.kycQuery) + '"></div>' +
            '<select id="kyc-sort" aria-label="Sort KYC submissions">' +
            '<option value="newest"' + (state.ui.kycSort === 'newest' ? ' selected' : '') + '>Newest first</option>' +
            '<option value="oldest"' + (state.ui.kycSort === 'oldest' ? ' selected' : '') + '>Oldest first</option></select></div></div>' +
            '<div id="kyc-results">' + kycResultsHtml() + '</div>';
    }

    function kycVisible() {
        var query = state.ui.kycQuery.trim().toLowerCase();
        var visible = Object.keys(state.kyc).map(function (key) {
            return { key: key, value: state.kyc[key] };
        }).filter(function (item) { return item.value && typeof item.value === 'object'; })
            .filter(function (item) { return item.value.status === state.ui.kycStatus; })
            .filter(function (item) {
                if (!query) return true;
                return [item.value.userName, item.value.userEmail, item.value.documentType, item.key]
                    .join(' ').toLowerCase().indexOf(query) !== -1;
            });
        visible.sort(function (a, b) {
            return state.ui.kycSort === 'oldest'
                ? Number(a.value.submittedAt || 0) - Number(b.value.submittedAt || 0)
                : Number(b.value.submittedAt || 0) - Number(a.value.submittedAt || 0);
        });
        return visible;
    }

    function kycResultsHtml() {
        var visible = kycVisible();
        var oldest = visible.length ? timeAgo(Math.min.apply(null, visible.map(function (item) {
            return Number(item.value.submittedAt || 0) || Date.now();
        }))) : '—';
        return '<p class="muted small" style="margin-bottom:10px">' + visible.length + ' submission' + (visible.length === 1 ? '' : 's') +
            ' · oldest in this view: ' + esc(oldest) + '</p>' +
            (visible.length ? '<div class="stack">' + visible.map(function (item) { return kycCard(item.key, item.value); }).join('') + '</div>'
                : '<div class="empty">No ' + esc(state.ui.kycStatus.toLowerCase()) + ' KYC submissions match this view.</div>');
    }

    function renderKycResults() {
        var container = $('#kyc-results');
        if (container) container.innerHTML = kycResultsHtml();
        hydrateProtectedKycImages().catch(function (error) { toast(error.message, 'error'); });
    }

    function supportListHtml() {
        var threads = supportThreads();
        var query = state.ui.supportQuery.trim().toLowerCase();
        var visible = threads.filter(function (thread) {
            if (!query) return true;
            return [thread.user.name, thread.user.email, thread.uid, thread.last.message]
                .join(' ').toLowerCase().indexOf(query) !== -1;
        });
        if (!visible.length) {
            return '<div class="empty">' + (threads.length ? 'No conversations match that search.' : 'No support conversations yet.') + '</div>';
        }
        return '<div class="thread-list">' + visible.map(function (thread) {
            var user = thread.user;
            var unread = supportUnread(thread);
            return '<button type="button" class="thread" data-action="open-thread" data-uid="' + esc(thread.uid) + '">' +
                avatarHtml(user.image, user.name) +
                '<div class="grow"><strong>' + esc(user.name) + '</strong><span>' + esc(user.email || thread.uid) + '</span>' +
                '<span class="thread-preview">' + esc(thread.last.message || '') + '</span></div>' +
                (unread ? '<span class="thread-unread" title="Replies waiting">' + unread + '</span>' : '') +
                '<span class="muted small">' + esc(timeAgo(thread.last.timestamp)) + '</span></button>';
        }).join('') + '</div>';
    }

    function supportView() {
        if (state.supportUid) {
            var uid = state.supportUid;
            var user = displayUser(uid);
            var presence = state.presence[uid];
            var online = presence && presence.online === true;
            var replies = [
                "Thanks for reaching out — I'm looking into this now.",
                'Could you share a screenshot or the listing link?',
                'This should be fixed in the latest app version. Please update and try again.',
                'Your account has been reviewed and restored. Sorry for the trouble.'
            ];
            return '<section class="page-head"><div><h1>Support</h1><p>Reply to the user directly from the web console.</p></div></section>' +
                '<div class="chat-shell"><div class="chat-head">' +
                '<button type="button" class="btn btn-ghost btn-small" data-action="close-thread">Back</button>' +
                avatarHtml(user.image, user.name) +
                '<div class="grow"><strong>' + esc(user.name) + '</strong><span id="chat-presence">' + esc(user.email || uid) + (online ? ' · Online' : ' · Offline') + '</span></div>' +
                '</div><div class="chat-messages" id="chat-messages">' + messagesHtml(uid) + '</div>' +
                '<div class="quick-replies">' + replies.map(function (text) {
                    return '<button type="button" class="quick-reply" data-action="quick-reply" data-message="' + esc(text) + '">' + esc(text.length > 42 ? text.slice(0, 40) + '…' : text) + '</button>';
                }).join('') + '</div>' +
                '<div class="composer"><textarea id="chat-input" rows="1" placeholder="Write a reply…" maxlength="4000"></textarea>' +
                '<button type="button" class="btn btn-primary" data-action="send-message">Send</button></div>' +
                '<p class="composer-hint">Enter sends · Shift+Enter adds a line · Replies are delivered to the app inbox</p></div>';
        }
        var unread = unreadConversations().length;
        return '<section class="page-head"><div><h1>Support</h1><p>' +
            (unread ? unread + ' conversation' + (unread === 1 ? '' : 's') + ' waiting on a reply.' : 'All conversations are answered.') + '</p></div></section>' +
            '<div class="toolbar"><div class="search"><input id="support-search" type="search" placeholder="Search name, email or message…" value="' + esc(state.ui.supportQuery) + '"></div></div>' +
            '<div id="support-list">' + supportListHtml() + '</div>';
    }

    function messagesHtml(uid) {
        var messages = Object.values(mapValues(state.support[uid]))
            .filter(function (message) { return message && typeof message === 'object'; })
            .sort(function (a, b) { return Number(a.timestamp || 0) - Number(b.timestamp || 0); });
        if (!messages.length) return '<div class="empty">No messages in this conversation yet.</div>';
        return messages.map(function (message) {
            var admin = message.admin === true || message.senderId === 'admin';
            var receipt = admin
                ? ' · ' + (message.isRead ? 'Read' : message.isDelivered ? 'Delivered' : 'Sent')
                : '';
            return '<div class="msg ' + (admin ? 'msg-admin' : 'msg-user') + '">' + esc(message.message || '') +
                '<span class="msg-meta">' + esc(fmtTs(message.timestamp)) + esc(receipt) + '</span></div>';
        }).join('');
    }

    function searchResultsHtml() {
        var query = state.ui.searchQuery.trim().toLowerCase();
        if (!query) return '<div class="empty">Search every listing by title, owner, location, developer, or type.</div>';
        var matches = propertyList().filter(function (property) {
            var owner = ownerOf(property);
            return [property.title, property.location, property.developer, property.propertyType, owner.name, owner.email]
                .join(' ').toLowerCase().indexOf(query) !== -1;
        });
        if (!matches.length) return '<div class="empty">No listings match “' + esc(state.ui.searchQuery.trim()) + '”.</div>';
        return matches.map(function (property) {
            return propertyCard(property, property._key, { status: true });
        }).join('');
    }

    function searchView() {
        return '<section class="page-head"><div><h1>Search</h1><p>Find any listing regardless of status.</p></div></section>' +
            '<div class="toolbar"><div class="search"><input id="search-properties" type="search" placeholder="Search listings…" value="' + esc(state.ui.searchQuery) + '"></div></div>' +
            '<div class="stack" id="search-results">' + searchResultsHtml() + '</div>';
    }

    /* -------------------- Broadcast -------------------- */

    function broadcastRecipients() {
        var audience = $('#bc-audience');
        var choice = audience ? audience.value : 'active';
        var users = userList();
        if (choice === 'single') {
            var picked = $('#bc-user');
            var uid = picked ? picked.value : '';
            return uid ? users.filter(function (user) { return user.uid === uid; }) : [];
        }
        if (choice === 'all') return users;
        return users.filter(function (user) { return !user.suspended; });
    }

    function broadcastView() {
        var users = userList();
        var active = users.filter(function (user) { return !user.suspended; });
        var userOptions = users.map(function (user) {
            return '<option value="' + esc(user.uid) + '">' + esc(user.name) + ' — ' + esc(user.email || user.uid) + '</option>';
        }).join('');
        return '<section class="page-head"><div><h1>Broadcast</h1><p>Send an in-app notification to one account or everyone.</p></div></section>' +
            '<div class="broadcast-card">' +
            '<div class="field-row"><div class="field"><label for="bc-audience">Audience</label>' +
            '<select id="bc-audience">' +
            '<option value="active">All active users (' + active.length + ')</option>' +
            '<option value="all">Everyone, incl. suspended (' + users.length + ')</option>' +
            '<option value="single">Single account</option></select></div>' +
            '<div class="field"><label for="bc-type">Notification type</label>' +
            '<select id="bc-type"><option value="system">System</option><option value="property">New listing</option>' +
            '<option value="promotion">Promotion</option><option value="alert">Alert</option></select></div></div>' +
            '<div class="field" id="bc-user-wrap" hidden><label for="bc-user">Account</label>' +
            '<select id="bc-user">' + userOptions + '</select></div>' +
            '<div class="field"><label for="bc-title">Title</label>' +
            '<input id="bc-title" maxlength="120" placeholder="e.g. Weekend property picks">' +
            '<span class="counter" id="bc-title-count">0 / 120</span></div>' +
            '<div class="field"><label for="bc-message">Message</label>' +
            '<textarea id="bc-message" maxlength="1000" placeholder="Write the notification body…"></textarea>' +
            '<span class="counter" id="bc-message-count">0 / 1,000</span></div>' +
            '<div class="audience-box" id="bc-audience-note">This will notify <strong>' + active.length + '</strong> accounts in their GharBato inbox.</div>' +
            '<div class="actions"><button type="button" class="btn btn-primary" data-action="send-broadcast">Send notification</button></div>' +
            '<p class="muted small" id="bc-progress"></p></div>';
    }

    function updateBroadcastCounters() {
        var title = $('#bc-title');
        var message = $('#bc-message');
        var note = $('#bc-audience-note');
        var audience = $('#bc-audience');
        var wrap = $('#bc-user-wrap');
        if (audience && wrap) wrap.hidden = audience.value !== 'single';
        function paint(input, counterId, max) {
            var counter = $('#' + counterId);
            if (!input || !counter) return;
            var length = String(input.value || '').length;
            counter.textContent = length + ' / ' + max.toLocaleString('en-US');
            counter.className = 'counter' + (length > max ? ' is-over' : '');
        }
        paint(title, 'bc-title-count', 120);
        paint(message, 'bc-message-count', 1000);
        if (note) {
            var recipients = broadcastRecipients();
            note.innerHTML = 'This will notify <strong>' + esc(recipients.length) + '</strong> account' +
                (recipients.length === 1 ? '' : 's') + ' in their GharBato inbox.';
        }
    }

    async function sendBroadcast() {
        var title = String(($('#bc-title') || {}).value || '').trim();
        var message = String(($('#bc-message') || {}).value || '').trim();
        var type = String(($('#bc-type') || {}).value || 'system');
        var recipients = broadcastRecipients();
        if (!title) return toast('Enter a notification title.', 'error');
        if (!message) return toast('Enter a notification message.', 'error');
        if (title.length > 120) return toast('Keep the title under 120 characters.', 'error');
        if (message.length > 1000) return toast('Keep the message under 1,000 characters.', 'error');
        if (!recipients.length) return toast('Choose at least one recipient.', 'error');

        openModal({
            title: 'Send notification',
            bodyHtml: '<p>Send <strong>' + esc(title) + '</strong> to <strong>' + recipients.length + '</strong> account' +
                (recipients.length === 1 ? '' : 's') + '?</p>' +
                '<div class="reason-box">' + esc(message) + '</div>' +
                '<p class="muted small">Notifications appear in the app inbox. Suspended users are only included when you choose everyone.</p>',
            confirmLabel: 'Send',
            onConfirm: async function () {
                var sent = 0;
                var failed = 0;
                var progress = $('#bc-progress');
                for (var i = 0; i < recipients.length; i += 5) {
                    var chunk = recipients.slice(i, i + 5);
                    var results = await Promise.allSettled(chunk.map(function (user) {
                        return createNotification(user.uid, title, message, type, '');
                    }));
                    results.forEach(function (result) {
                        if (result.status === 'fulfilled') sent += 1;
                        else failed += 1;
                    });
                    if (progress) progress.textContent = 'Sending… ' + Math.min(i + 5, recipients.length) + ' / ' + recipients.length;
                }
                if (progress) {
                    progress.textContent = failed
                        ? sent + ' delivered, ' + failed + ' failed. Retry the failed ones later.'
                        : sent + ' notifications delivered.';
                }
                toast(failed ? 'Broadcast finished with ' + failed + ' failed.' : 'Broadcast sent to ' + sent + ' accounts.',
                    failed ? 'error' : 'ok');
            }
        });
    }

    function promptNotifyUser(uid) {
        var user = displayUser(uid);
        openModal({
            title: 'Send notification',
            bodyHtml: '<p>Notify <strong>' + esc(user.name) + '</strong> (' + esc(user.email || uid) + ').</p>' +
                '<label for="modal-notify-title">Title</label><input id="modal-notify-title" maxlength="120" placeholder="Notification title">' +
                '<label for="modal-reason">Message</label><textarea id="modal-reason" maxlength="1000" placeholder="Message body"></textarea>',
            confirmLabel: 'Send',
            onConfirm: async function () {
                var title = String(($('#modal-notify-title') || {}).value || '').trim();
                var message = String(($('#modal-reason') || {}).value || '').trim();
                if (!title || !message) throw new Error('Enter both a title and a message.');
                await createNotification(uid, title, message, 'system', '');
                toast('Notification sent to ' + user.name + '.');
            }
        });
    }

    /* -------------------- Global search -------------------- */

    function globalMatches(query) {
        var q = String(query || '').trim().toLowerCase();
        if (!q) return [];
        var results = [];
        propertyList().filter(function (property) {
            return matchesQuery(property, q);
        }).slice(0, 5).forEach(function (property) {
            results.push({
                type: 'listing', kind: 'Listing', key: property._key, uid: property.ownerId,
                title: property.title || 'Untitled listing',
                sub: [priceLabel(property), property.location || 'No location', property.status].filter(Boolean).join(' · ')
            });
        });
        userList().filter(function (user) {
            return [user.name, user.email, user.uid, user.phone].join(' ').toLowerCase().indexOf(q) !== -1;
        }).slice(0, 4).forEach(function (user) {
            results.push({
                type: 'user', kind: 'User', uid: user.uid,
                title: user.name, sub: user.email || user.uid
            });
        });
        Object.keys(state.kyc).filter(function (key) {
            var submission = state.kyc[key] || {};
            return [submission.userName, submission.userEmail, submission.documentType, submission.status, key]
                .join(' ').toLowerCase().indexOf(q) !== -1;
        }).slice(0, 3).forEach(function (key) {
            var submission = state.kyc[key];
            results.push({
                type: 'kyc', kind: 'KYC', key: key, uid: submission.userId,
                title: submission.userName || submission.userEmail || 'KYC submission',
                sub: (submission.status || 'Pending') + ' · ' + (submission.documentType || 'Document')
            });
        });
        supportThreads().filter(function (thread) {
            return [thread.user.name, thread.user.email, thread.uid, thread.last.message]
                .join(' ').toLowerCase().indexOf(q) !== -1;
        }).slice(0, 3).forEach(function (thread) {
            results.push({
                type: 'support', kind: 'Support', uid: thread.uid,
                title: thread.user.name, sub: thread.last.message || 'No messages'
            });
        });
        return results;
    }

    function globalResultsHtml(results) {
        if (!results.length) {
            var input = $('#global-search');
            return '<div class="gs-empty">No matches for “' + esc(input ? input.value : '') + '”.</div>';
        }
        return results.map(function (result, index) {
            return '<button type="button" class="gs-item' + (index === state.globalFocus ? ' is-focused' : '') + '" data-action="gs-pick" data-index="' + index + '">' +
                '<span class="gs-kind">' + esc(result.kind) + '</span>' +
                '<span class="grow"><strong>' + esc(result.title) + '</strong><span>' + esc(result.sub) + '</span></span></button>';
        }).join('');
    }

    function renderGlobalResults() {
        var panel = $('#global-search-results');
        if (!panel) return;
        var input = $('#global-search');
        var value = input ? String(input.value || '').trim() : '';
        if (!value) {
            panel.hidden = true;
            panel.innerHTML = '';
            return;
        }
        panel.innerHTML = globalResultsHtml(state.globalResults);
        panel.hidden = false;
    }

    function closeGlobalResults() {
        var panel = $('#global-search-results');
        if (panel) panel.hidden = true;
        state.globalFocus = -1;
    }

    async function chooseGlobalResult(result) {
        if (!result) return;
        closeGlobalResults();
        var input = $('#global-search');
        if (input) input.value = '';
        state.globalResults = [];
        state.globalFocus = -1;
        if (result.type === 'user') {
            openUserProfile(result.uid);
            return;
        }
        if (result.type === 'support') {
            state.ui.supportQuery = '';
            await setView('support');
            await openThread(result.uid);
            return;
        }
        if (result.type === 'kyc') {
            var submission = state.kyc[result.key] || {};
            state.ui.kycStatus = submission.status === 'Approved' || submission.status === 'Rejected' ? submission.status : 'Pending';
            state.ui.kycQuery = submission.userName || submission.userEmail || '';
            await setView('kyc');
            return;
        }
        var property = state.properties[result.key];
        state.ui.listingStatus = property && property.status ? property.status : 'PENDING';
        state.ui.listingQuery = result.title;
        await setView('listings');
        toggleDetails(result.key);
    }

    function showShortcuts() {
        openModal({
            title: 'Keyboard shortcuts',
            bodyHtml: '<dl class="detail-grid">' +
                '<div><dt>/</dt><dd>Focus global search</dd></div>' +
                '<div><dt>Esc</dt><dd>Close search or dialog</dd></div>' +
                '<div><dt>↑ ↓</dt><dd>Move through search results</dd></div>' +
                '<div><dt>Enter</dt><dd>Open the highlighted result</dd></div>' +
                '<div><dt>R</dt><dd>Refresh admin data</dd></div>' +
                '</dl>',
            confirmLabel: 'Close',
            hideCancel: true,
            onConfirm: function () { }
        });
    }

    function rejectedListHtml() {
        var query = state.ui.deleteQuery.trim().toLowerCase();
        var items = propertyList().filter(function (property) { return property.status === 'REJECTED'; })
            .filter(function (property) {
                if (!query) return true;
                var owner = ownerOf(property);
                return [property.title, property.location, owner.name, owner.email].join(' ').toLowerCase().indexOf(query) !== -1;
            });
        if (!items.length) return '<div class="empty">No rejected listings.</div>';
        return '<div class="stack">' + items.map(function (property) {
            var owner = ownerOf(property);
            return '<article class="listing-card"><div class="listing-media">' +
                (propertyImage(property) ? imgTag(propertyImage(property), property.title || 'Listing', '') : '<span class="placeholder">No photo</span>') +
                '</div><div class="listing-body"><div class="row-between"><h3>' + esc(property.title || 'Untitled listing') + '</h3>' + badge('REJECTED') + '</div>' +
                '<p class="meta">' + esc(priceLabel(property)) + ' · ' + esc(property.location || 'No location') + '</p>' +
                '<div class="owner">' + avatarHtml(owner.image, owner.name) + '<div class="owner-text"><strong>' + esc(owner.name) + '</strong><span>' + esc(owner.email || 'No email') + '</span></div></div>' +
                '<div class="actions"><button type="button" class="btn btn-ghost btn-small" data-action="restore-property" data-key="' + esc(property._key) + '">Restore</button>' +
                '<button type="button" class="btn btn-danger btn-small" data-action="delete-property" data-key="' + esc(property._key) + '">Delete permanently</button></div>' +
                '</div></article>';
        }).join('') + '</div>';
    }

    function historyListHtml() {
        var query = state.ui.deleteQuery.trim().toLowerCase();
        var records = Object.keys(state.deletionHistory).map(function (key) {
            return Object.assign({ _key: key }, state.deletionHistory[key]);
        }).filter(function (record) {
            if (!query) return true;
            return [record.propertyTitle, record.ownerName, record.ownerEmail].join(' ').toLowerCase().indexOf(query) !== -1;
        }).sort(function (a, b) { return Number(b.deletedTimestamp || 0) - Number(a.deletedTimestamp || 0); });
        if (!records.length) return '<div class="empty">No deletions recorded.</div>';
        return '<div class="stack">' + records.map(function (record) {
            return '<div class="history-row"><div class="grow"><strong>' + esc(record.propertyTitle || 'Listing') + '</strong>' +
                '<span>' + esc(record.ownerName || 'Unknown owner') + (record.ownerEmail ? ' · ' + esc(record.ownerEmail) : '') + '</span>' +
                '<span>Deleted ' + esc(record.deletedDate || fmtTs(record.deletedTimestamp)) + ' by ' + esc(record.deletedBy || 'Admin') + '</span></div>' +
                '<span class="badge badge-rejected"># ' + esc(record.propertyId) + '</span></div>';
        }).join('') + '</div>';
    }

    function renderDeleteResults() {
        var container = $('#delete-results');
        if (!container) return;
        container.innerHTML = state.ui.deleteTab === 'rejected' ? rejectedListHtml() : historyListHtml();
    }

    function deleteView() {
        var rejectedTab = state.ui.deleteTab === 'rejected' ? ' is-active' : '';
        var historyTab = state.ui.deleteTab === 'history' ? ' is-active' : '';
        var rejectedCount = propertyList().filter(function (property) { return property.status === 'REJECTED'; }).length;
        var historyCount = Object.keys(state.deletionHistory).length;
        return '<section class="page-head"><div><h1>Deletion</h1><p>Permanently remove rejected listings or restore them for review.</p></div></section>' +
            '<div class="toolbar"><div class="segmented">' +
            '<button type="button" class="seg' + rejectedTab + '" data-action="delete-tab" data-tab="rejected">Rejected<span class="seg-count">' + rejectedCount + '</span></button>' +
            '<button type="button" class="seg' + historyTab + '" data-action="delete-tab" data-tab="history">History<span class="seg-count">' + historyCount + '</span></button>' +
            '</div><div class="search"><input id="delete-search" type="search" placeholder="Search title or owner…" value="' + esc(state.ui.deleteQuery) + '"></div></div>' +
            '<div id="delete-results">' + (state.ui.deleteTab === 'rejected' ? rejectedListHtml() : historyListHtml()) + '</div>';
    }

    function render() {
        if (!state.session) return;
        clearKycObjectUrls();
        var email = $('#account-email');
        if (email) email.textContent = state.session.email || '';
        updateTabs();
        var root = $('#view-root');
        if (!root) return;
        if (!state.loaded) {
            root.innerHTML = loadingView();
            return;
        }
        var html = '';
        if (state.loadError) html += '<div class="banner-error">' + esc(state.loadError) + '</div>';
        switch (state.view) {
            case 'listings': html += listingsView(); break;
            case 'reports': html += reportsView(); break;
            case 'users': html += usersView(); break;
            case 'kyc': html += kycView(); break;
            case 'support': html += supportView(); break;
            case 'broadcast': html += broadcastView(); break;
            case 'search': html += searchView(); break;
            case 'delete': html += deleteView(); break;
            default: html += overviewView(); break;
        }
        root.innerHTML = html;
        if (state.view === 'listings') renderListingResults();
        if (state.view === 'kyc') hydrateProtectedKycImages().catch(function (error) { toast(error.message, 'error'); });
        if (state.view === 'support' && state.supportUid) scrollChatToBottom();
        updateSyncStatus();
    }

    function updateTabs() {
        var tabs = document.querySelectorAll('.tab[data-view], .nav-item[data-view]');
        for (var i = 0; i < tabs.length; i += 1) {
            var active = tabs[i].getAttribute('data-view') === state.view;
            tabs[i].classList.toggle('is-active', active);
            if (active) tabs[i].setAttribute('aria-current', 'page');
            else tabs[i].removeAttribute('aria-current');
        }
        updateNavCounts();
    }

    function updateNavCounts() {
        if (!state.loaded) return;
        var properties = propertyList();
        var pending = properties.filter(function (property) { return property.status === 'PENDING'; }).length;
        var counts = {
            overview: pending,
            listings: pending,
            kyc: Object.keys(state.kyc).filter(function (key) { return state.kyc[key] && state.kyc[key].status === 'Pending'; }).length,
            reports: pendingPropertyReports().length + groupedUserReports().length,
            users: Object.keys(state.users).length,
            support: unreadConversations().length,
            broadcast: '',
            search: '',
            delete: properties.filter(function (property) { return property.status === 'REJECTED'; }).length
        };
        Object.keys(counts).forEach(function (view) {
            var nodes = document.querySelectorAll('.nav-count[data-count="' + view + '"]');
            for (var i = 0; i < nodes.length; i += 1) {
                nodes[i].textContent = counts[view] === '' ? '' : String(counts[view]);
            }
        });
    }

    /* -------------------- Modal and toast -------------------- */

    function toast(message, kind) {
        var el = $('#toast');
        if (!el) return;
        el.textContent = message;
        el.className = 'toast' + (kind === 'error' ? ' is-error' : '');
        el.hidden = false;
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () { el.hidden = true; }, 3800);
    }

    function closeModal() {
        var root = $('#modal-root');
        if (root) root.innerHTML = '';
    }

    function openModal(options) {
        var root = $('#modal-root');
        if (!root) return;
        root.innerHTML = '<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
            '<h2 id="modal-title">' + esc(options.title) + '</h2>' +
            '<div class="modal-body">' + options.bodyHtml + '<p class="modal-error" id="modal-error" role="alert" hidden></p></div>' +
            '<div class="modal-actions">' + (options.hideCancel ? '' : '<button type="button" class="btn btn-ghost" data-action="close-modal">Cancel</button>') +
            '<button type="button" class="btn ' + (options.confirmClass || 'btn-primary') + '" id="modal-confirm">' + esc(options.confirmLabel || 'Confirm') + '</button></div>' +
            '</div></div>';
        var confirm = $('#modal-confirm');
        confirm.addEventListener('click', async function () {
            var errorEl = $('#modal-error');
            errorEl.hidden = true;
            confirm.disabled = true;
            var previous = confirm.textContent;
            confirm.textContent = 'Working…';
            try {
                await options.onConfirm();
                closeModal();
            } catch (error) {
                if (error && error.authFailure) {
                    closeModal();
                    signOut(error.message);
                    return;
                }
                errorEl.textContent = error && error.message ? error.message : 'Something went wrong.';
                errorEl.hidden = false;
                confirm.disabled = false;
                confirm.textContent = previous;
            }
        });
        var firstInput = root.querySelector('select, textarea, input');
        if (firstInput) firstInput.focus();
    }

    function openImage(src) {
        var url = state.kycObjectUrls.indexOf(src) !== -1 ? src : imageUrl(src);
        if (!url) return;
        openModal({
            title: 'Document',
            bodyHtml: '<img class="modal-image" src="' + esc(url) + '" alt="Uploaded document">',
            confirmLabel: 'Close',
            hideCancel: true,
            onConfirm: function () { }
        });
    }

    /* -------------------- Actions -------------------- */

    var VIEWS = ['overview', 'listings', 'reports', 'users', 'kyc', 'support', 'broadcast', 'search', 'delete'];

    async function setView(view) {
        if (!view || VIEWS.indexOf(view) === -1) return;
        state.view = view;
        state.supportUid = view === 'support' ? state.supportUid : null;
        if (view !== 'listings') state.ui.selected = {};
        stopPoll();
        closeGlobalResults();
        state.loadError = '';
        closeSidebar();
        try {
            if (window.location && String(window.location.hash || '') !== '#/' + view) {
                window.location.hash = '#/' + view;
            }
        } catch (error) {
            // Hash routing is optional.
        }
        if (view === 'support') {
            try {
                await loadSupport();
            } catch (error) {
                state.loadError = error.message;
            }
        }
        render();
        var viewRoot = $('#view-root');
        if (viewRoot) viewRoot.scrollTop = 0;
        if (view === 'support') startSupportPoll();
    }

    function initialView() {
        var hash = String((window.location && window.location.hash) || '').replace(/^#\/?/, '').split('/')[0];
        return VIEWS.indexOf(hash) !== -1 ? hash : 'overview';
    }

    function closeSidebar() {
        var sidebar = $('#sidebar');
        var scrim = $('.sidebar-scrim');
        if (sidebar) sidebar.classList.remove('is-open');
        if (scrim) scrim.hidden = true;
    }

    function toggleSidebar() {
        var sidebar = $('#sidebar');
        var scrim = $('.sidebar-scrim');
        if (!sidebar) return;
        var open = sidebar.classList.toggle('is-open');
        if (scrim) scrim.hidden = !open;
    }

    function toggleDetails(key) {
        var details = document.getElementById('details-' + key);
        if (!details) return;
        if (details.hasAttribute('hidden')) details.removeAttribute('hidden');
        else details.setAttribute('hidden', '');
    }

    function findPropertyKeyById(propertyId) {
        return Object.keys(state.properties).find(function (key) {
            return String(state.properties[key].id) === String(propertyId);
        }) || '';
    }

    function updateProperty(key, patch) {
        if (!state.properties[key]) return;
        state.properties[key] = Object.assign({}, state.properties[key], patch);
    }

    /* -------------------- Public share projections -------------------- */

    // SharedProperties/<key> is the only listing data strangers may read. It is
    // written here, from approved listings, and rendered by share-worker (or the
    // static gharbato-share.html fallback). Keep the field list in sync with
    // share-worker/README.md and the validation rules in database.rules.json.

    var SHARE_IMAGE_HOSTS = ['res.cloudinary.com', 'lh3.googleusercontent.com'];
    var SHARE_IMAGE_LIMIT = 12;

    function shareText(value, limit) {
        var text = typeof value === 'string' ? value.trim() : '';
        return text.length > limit ? text.slice(0, limit) : text;
    }

    function shareNumber(value, min, max) {
        var parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        return Math.min(max, Math.max(min, Math.round(parsed)));
    }

    function shareCoordinate(value, limit) {
        var parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed === 0) return null;
        if (Math.abs(parsed) > limit) return null;
        return Math.round(parsed * 1000) / 1000;
    }

    function shareImageUrl(value) {
        var raw = typeof value === 'string' ? value.trim() : '';
        if (!raw || raw.indexOf('https://') !== 0) return '';
        return SHARE_IMAGE_HOSTS.some(function (host) {
            return raw.indexOf('https://' + host + '/') === 0;
        }) && raw.length <= 2048 ? raw : '';
    }

    function shareImages(raw) {
        var total = 0;
        var out = {};
        if (!raw || typeof raw !== 'object') return out;
        Object.keys(raw).forEach(function (category) {
            if (!/^(cover|exterior|living|bedrooms|bathrooms|kitchen|other)$/.test(category)) return;
            var list = Array.isArray(raw[category]) ? raw[category] : [raw[category]];
            var urls = [];
            list.forEach(function (value) {
                if (total >= SHARE_IMAGE_LIMIT) return;
                var url = shareImageUrl(value);
                if (url && urls.indexOf(url) === -1) {
                    urls.push(url);
                    total += 1;
                }
            });
            if (urls.length) out[category] = urls;
        });
        return out;
    }

    function shareAmenities(raw) {
        if (!Array.isArray(raw)) return [];
        var out = [];
        raw.forEach(function (value) {
            var text = shareText(typeof value === 'string' ? value : '', 80);
            if (text && out.indexOf(text) === -1 && out.length < 20) out.push(text);
        });
        return out;
    }

    function shareProjection(property) {
        if (!property) return null;
        if (String(property.status || '').toUpperCase() !== 'APPROVED') return null;
        var title = shareText(property.title, 200);
        if (!title) return null;
        var projection = {
            title: title,
            description: shareText(property.description, 5000),
            price: shareText(property.price, 100),
            marketType: shareText(property.marketType, 60),
            location: shareText(property.location, 300),
            propertyType: shareText(property.propertyType, 60),
            bedrooms: shareNumber(property.bedrooms, 0, 100),
            bathrooms: shareNumber(property.bathrooms, 0, 100),
            sqft: shareText(property.sqft, 60),
            floor: shareText(property.floor, 60),
            furnishing: shareText(property.furnishing, 60),
            parking: property.parking === true,
            petsAllowed: property.petsAllowed === true,
            images: shareImages(property.images),
            amenities: shareAmenities(property.amenities),
            availableFrom: shareText(property.availableFrom, 80),
            minimumLease: shareText(property.minimumLease, 80),
            advancePayment: shareText(property.advancePayment, 80),
            securityDeposit: shareText(property.securityDeposit, 80),
            utilitiesIncluded: shareText(property.utilitiesIncluded, 200),
            commission: shareText(property.commission, 80),
            totalRooms: shareText(property.totalRooms, 40),
            kitchen: shareText(property.kitchen, 60),
            ownerName: shareText(property.ownerName, 200),
            ownerImageUrl: shareImageUrl(property.ownerImageUrl),
            latitude: shareCoordinate(property.latitude, 90),
            longitude: shareCoordinate(property.longitude, 180),
            updatedAt: Number(property.updatedAt) || Date.now()
        };
        if (projection.latitude === null || projection.longitude === null) {
            delete projection.latitude;
            delete projection.longitude;
        }
        return projection;
    }

    // Ignore updatedAt when deciding whether the published copy is stale, so a
    // view counter bump never triggers a rewrite.
    function shareSignature(entry) {
        if (!entry) return '';
        var copy = Object.assign({}, entry);
        delete copy.updatedAt;
        return JSON.stringify(copy);
    }

    async function publishShareEntry(key) {
        if (!state.session || !state.properties[key]) return;
        var projection = shareProjection(state.properties[key]);
        if (!projection) {
            await unpublishShareEntry(key);
            return;
        }
        if (shareSignature(state.shared[key]) === shareSignature(projection)) return;
        await dbPut('SharedProperties/' + enc(key), projection);
        state.shared[key] = projection;
    }

    async function unpublishShareEntry(key) {
        if (!state.session) return;
        if (!state.shared[key]) return;
        await dbDelete('SharedProperties/' + enc(key));
        delete state.shared[key];
    }

    function bestEffort(promise) {
        return Promise.resolve(promise).catch(function (error) {
            if (window.console && console.warn) console.warn('Share link update failed', error && error.message);
        });
    }

    async function syncSharedProperties(options) {
        options = options || {};
        var summary = { written: 0, removed: 0, failed: 0 };
        if (!state.session) return summary;
        var queued = {};
        var batch = [];
        Object.keys(state.properties).forEach(function (key) {
            var projection = shareProjection(state.properties[key]);
            if (!projection) {
                if (state.shared[key]) {
                    queued[key] = true;
                    batch.push({ key: key, remove: true });
                }
                return;
            }
            if (shareSignature(state.shared[key]) !== shareSignature(projection)) {
                queued[key] = true;
                batch.push({ key: key, projection: projection });
            }
        });
        Object.keys(state.shared).forEach(function (key) {
            if (!state.properties[key] && !queued[key]) {
                queued[key] = true;
                batch.push({ key: key, remove: true });
            }
        });
        for (var i = 0; i < batch.length; i += 5) {
            var chunk = batch.slice(i, i + 5);
            var results = await Promise.allSettled(chunk.map(function (item) {
                return item.remove
                    ? dbDelete('SharedProperties/' + enc(item.key))
                    : dbPut('SharedProperties/' + enc(item.key), item.projection);
            }));
            results.forEach(function (result, index) {
                var item = chunk[index];
                if (result.status === 'fulfilled') {
                    if (item.remove) {
                        delete state.shared[item.key];
                        summary.removed += 1;
                    } else {
                        state.shared[item.key] = item.projection;
                        summary.written += 1;
                    }
                } else {
                    summary.failed += 1;
                }
            });
        }
        if (options.force && window.console && console.info) {
            console.info('Share links synced', summary);
        }
        return summary;
    }

    function confirmApproveListing(key) {
        var property = state.properties[key];
        if (!property) return;
        openModal({
            title: 'Approve listing',
            bodyHtml: '<p>Approve <strong>' + esc(property.title || 'this listing') + '</strong>?</p>' +
                '<p>It becomes visible to all users, and the owner plus every user will be notified.</p>',
            confirmLabel: 'Approve',
            onConfirm: async function () {
                await dbPatch('Property/' + enc(key), { status: 'APPROVED' });
                updateProperty(key, { status: 'APPROVED' });
                await bestEffort(publishShareEntry(key));
                var owner = ownerOf(property);
                var notificationFailed = false;
                try {
                    await createNotification(property.ownerId, '🎉 Property Approved!',
                        "Your property '" + (property.title || '') + "' has been approved and is now live!",
                        'listing_approved', property.id);
                    var result = await notifyAllUsers('🏠 New Listing Available',
                        'Check out the new property: ' + (property.title || ''), 'property', property.id);
                    notificationFailed = result.failed > 0;
                } catch (error) {
                    notificationFailed = true;
                }
                render();
                toast(notificationFailed ? 'Listing approved, but some notifications failed.' : 'Listing approved.',
                    notificationFailed ? 'error' : 'ok');
            }
        });
    }

    function promptRejectListing(key) {
        var property = state.properties[key];
        if (!property) return;
        openModal({
            title: 'Reject listing',
            bodyHtml: '<p>Reject <strong>' + esc(property.title || 'this listing') + '</strong>? The owner will be told why.</p>' +
                '<label for="modal-reason">Reason</label><textarea id="modal-reason" placeholder="Explain what needs to change"></textarea>',
            confirmLabel: 'Reject',
            confirmClass: 'btn-danger',
            onConfirm: async function () {
                var reason = ($('#modal-reason').value || '').trim();
                if (!reason) throw new Error('Enter a rejection reason.');
                await dbPatch('Property/' + enc(key), { status: 'REJECTED' });
                updateProperty(key, { status: 'REJECTED' });
                await bestEffort(unpublishShareEntry(key));
                try {
                    await createNotification(property.ownerId, '❌ Property Rejected',
                        "Your property '" + (property.title || '') + "' was rejected. Reason: " + reason,
                        'system', property.id);
                } catch (error) {
                    // The rejection itself succeeded; surface the notification issue below.
                }
                render();
                toast('Listing rejected.');
            }
        });
    }

    function selectedPendingProperties() {
        return selectedKeys().map(function (key) { return state.properties[key]; })
            .filter(function (property) { return property && property.status === 'PENDING'; });
    }

    async function patchListings(keys, patch) {
        var succeeded = [];
        var failed = 0;
        for (var i = 0; i < keys.length; i += 5) {
            var chunk = keys.slice(i, i + 5);
            var results = await Promise.allSettled(chunk.map(function (key) {
                return dbPatch('Property/' + enc(key), patch);
            }));
            results.forEach(function (result, index) {
                if (result.status === 'fulfilled') succeeded.push(chunk[index]);
                else failed += 1;
            });
        }
        return { succeeded: succeeded, failed: failed };
    }

    function bulkApprove() {
        var properties = selectedPendingProperties();
        if (!properties.length) return toast('Select at least one pending listing.', 'error');
        openModal({
            title: 'Approve ' + properties.length + ' listing' + (properties.length === 1 ? '' : 's'),
            bodyHtml: '<p>Approve ' + properties.length + ' listing' + (properties.length === 1 ? '' : 's') +
                '? They become visible immediately and their owners are notified.</p>' +
                '<p class="muted small">Every other user gets one “new listings” notification instead of one per property.</p>',
            confirmLabel: 'Approve all',
            onConfirm: async function () {
                var keys = properties.map(function (property) { return property._key; });
                var outcome = await patchListings(keys, { status: 'APPROVED' });
                outcome.succeeded.forEach(function (key) {
                    updateProperty(key, { status: 'APPROVED' });
                });
                var notificationsFailed = 0;
                for (var i = 0; i < outcome.succeeded.length; i += 5) {
                    var chunk = outcome.succeeded.slice(i, i + 5);
                    var results = await Promise.allSettled(chunk.map(function (key) {
                        var property = state.properties[key] || {};
                        return createNotification(property.ownerId, '🎉 Property Approved!',
                            "Your property '" + (property.title || '') + "' has been approved and is now live!",
                            'listing_approved', property.id);
                    }));
                    notificationsFailed += results.filter(function (result) { return result.status === 'rejected'; }).length;
                }
                if (outcome.succeeded.length) {
                    try {
                        await notifyAllUsers('🏠 New Listings Available',
                            outcome.succeeded.length + ' new propert' + (outcome.succeeded.length === 1 ? 'y is' : 'ies are') + ' now live on GharBato.',
                            'property', '');
                    } catch (error) {
                        notificationsFailed += 1;
                    }
                }
                await bestEffort(syncSharedProperties());
                state.ui.selected = {};
                render();
                var summary = outcome.succeeded.length + ' approved' + (outcome.failed ? ', ' + outcome.failed + ' failed' : '');
                toast(notificationsFailed ? summary + '. Some notifications failed.' : summary + '.',
                    outcome.failed || notificationsFailed ? 'error' : 'ok');
            }
        });
    }

    function bulkReject() {
        var properties = selectedPendingProperties();
        if (!properties.length) return toast('Select at least one pending listing.', 'error');
        openModal({
            title: 'Reject ' + properties.length + ' listing' + (properties.length === 1 ? '' : 's'),
            bodyHtml: '<p>Reject ' + properties.length + ' listing' + (properties.length === 1 ? '' : 's') +
                '? Each owner receives this reason.</p>' +
                '<label for="modal-reason">Reason</label><textarea id="modal-reason" placeholder="Explain what needs to change"></textarea>',
            confirmLabel: 'Reject all',
            confirmClass: 'btn-danger',
            onConfirm: async function () {
                var reason = String(($('#modal-reason') || {}).value || '').trim();
                if (!reason) throw new Error('Enter a rejection reason.');
                var keys = properties.map(function (property) { return property._key; });
                var outcome = await patchListings(keys, { status: 'REJECTED' });
                outcome.succeeded.forEach(function (key) {
                    updateProperty(key, { status: 'REJECTED' });
                });
                for (var i = 0; i < outcome.succeeded.length; i += 5) {
                    var chunk = outcome.succeeded.slice(i, i + 5);
                    await Promise.allSettled(chunk.map(function (key) {
                        var property = state.properties[key] || {};
                        return createNotification(property.ownerId, '❌ Property Rejected',
                            "Your property '" + (property.title || '') + "' was rejected. Reason: " + reason,
                            'system', property.id);
                    }));
                }
                await bestEffort(syncSharedProperties());
                state.ui.selected = {};
                render();
                toast(outcome.succeeded.length + ' rejected' + (outcome.failed ? ', ' + outcome.failed + ' failed' : '') + '.',
                    outcome.failed ? 'error' : 'ok');
            }
        });
    }

    function confirmKeepReport(propertyId) {
        var reportKeys = reportsForProperty(propertyId);
        if (!reportKeys.length) return;
        openModal({
            title: 'Keep listing',
            bodyHtml: '<p>Dismiss every open report for this listing? The listing stays live.</p>',
            confirmLabel: 'Keep listing',
            onConfirm: async function () {
                await Promise.all(reportKeys.map(function (key) {
                    return dbPatch('ReportedProperties/' + enc(key), { status: 'DISMISSED' });
                }));
                reportKeys.forEach(function (key) {
                    if (state.reports[key]) state.reports[key].status = 'DISMISSED';
                });
                render();
                toast('Reports dismissed.');
            }
        });
    }

    function confirmRemoveReport(propertyId) {
        var reportKeys = reportsForProperty(propertyId);
        if (!reportKeys.length) return;
        var latest = Object.keys(state.reports).map(function (key) { return state.reports[key]; })
            .filter(function (report) { return report && String(report.propertyId) === String(propertyId); })
            .sort(function (a, b) { return Number(b.reportedAt || 0) - Number(a.reportedAt || 0); })[0] || {};
        var propertyKey = findPropertyKeyById(propertyId);
        var title = latest.propertyTitle || (propertyKey ? state.properties[propertyKey].title : 'this listing');
        openModal({
            title: 'Remove reported listing',
            bodyHtml: '<p>Remove <strong>' + esc(title || 'this listing') + '</strong>? The listing is marked rejected and the owner is notified.</p>',
            confirmLabel: 'Remove listing',
            confirmClass: 'btn-danger',
            onConfirm: async function () {
                await Promise.all(reportKeys.map(function (key) {
                    return dbPatch('ReportedProperties/' + enc(key), { status: 'REVIEWED' });
                }));
                reportKeys.forEach(function (key) {
                    if (state.reports[key]) state.reports[key].status = 'REVIEWED';
                });
                if (propertyKey) {
                    await dbPatch('Property/' + enc(propertyKey), { status: 'REJECTED' });
                    updateProperty(propertyKey, { status: 'REJECTED' });
                    await bestEffort(unpublishShareEntry(propertyKey));
                    try {
                        await createNotification(latest.ownerId || state.properties[propertyKey].ownerId,
                            '⚠️ Property Removed',
                            "Your property '" + (title || '') + "' has been removed due to reports violating our community guidelines.",
                            'system', propertyId);
                    } catch (error) {
                        // Report removal succeeded even if the notification failed.
                    }
                }
                render();
                toast('Reported listing removed.');
            }
        });
    }

    function promptSuspendUser(uid) {
        var user = displayUser(uid);
        openModal({
            title: 'Suspend user',
            bodyHtml: '<p>Suspend <strong>' + esc(user.name) + '</strong> (' + esc(user.email || uid) + ').</p>' +
                '<label for="modal-duration">Duration</label>' +
                '<select id="modal-duration"><option value="3">3 days</option><option value="7">1 week</option>' +
                '<option value="30">1 month</option><option value="36500">Permanent</option></select>' +
                '<label for="modal-reason">Reason</label>' +
                '<input id="modal-reason" value="Violation of community guidelines">',
            confirmLabel: 'Suspend',
            confirmClass: 'btn-danger',
            onConfirm: async function () {
                var days = Number($('#modal-duration').value);
                var reason = ($('#modal-reason').value || '').trim();
                if (!reason) throw new Error('Enter a suspension reason.');
                var until = Date.now() + days * 24 * 60 * 60 * 1000;
                await dbPatch('Users/' + enc(uid), {
                    isSuspended: true,
                    suspendedUntil: until,
                    suspensionReason: reason
                });
                if (state.users[uid]) state.users[uid] = Object.assign({}, state.users[uid], {
                    isSuspended: true,
                    suspendedUntil: until,
                    suspensionReason: reason
                });
                render();
                toast('User suspended.');
            }
        });
    }

    function confirmActivateUser(uid) {
        var user = displayUser(uid);
        openModal({
            title: 'Activate user',
            bodyHtml: '<p>Restore access for <strong>' + esc(user.name) + '</strong>?</p>',
            confirmLabel: 'Activate',
            onConfirm: async function () {
                await dbPatch('Users/' + enc(uid), { isSuspended: false, suspendedUntil: 0, suspensionReason: '' });
                if (state.users[uid]) state.users[uid] = Object.assign({}, state.users[uid], {
                    isSuspended: false,
                    suspendedUntil: 0,
                    suspensionReason: ''
                });
                render();
                toast('User activated.');
            }
        });
    }

    function confirmResolveUser(uid) {
        var keys = Object.keys(state.userReports).filter(function (key) {
            return state.userReports[key] && state.userReports[key].reportedUserId === uid;
        });
        openModal({
            title: 'Resolve reports',
            bodyHtml: '<p>Delete all ' + keys.length + ' report' + (keys.length === 1 ? '' : 's') + ' for this user? This does not change their account status.</p>',
            confirmLabel: 'Resolve',
            onConfirm: async function () {
                await Promise.all(keys.map(function (key) {
                    return dbDelete('user_reports/' + enc(key));
                }));
                keys.forEach(function (key) { delete state.userReports[key]; });
                render();
                toast('Reports resolved.');
            }
        });
    }

    function confirmKycApprove(key) {
        var submission = state.kyc[key];
        if (!submission) return;
        openModal({
            title: 'Approve KYC',
            bodyHtml: '<p>Approve the identity documents from <strong>' + esc(submission.userName || submission.userEmail || 'this user') + '</strong>?</p>',
            confirmLabel: 'Approve',
            onConfirm: async function () {
                var now = Date.now();
                await dbPatch('KycSubmissions/' + enc(key), {
                    status: 'Approved',
                    reviewedAt: now,
                    reviewedBy: 'Admin',
                    rejectionReason: ''
                });
                state.kyc[key] = Object.assign({}, submission, {
                    status: 'Approved', reviewedAt: now, reviewedBy: 'Admin', rejectionReason: ''
                });
                try {
                    await createNotification(submission.userId, 'KYC Approved',
                        'Congratulations! Your KYC verification has been approved. You can now access all features.',
                        'system', '');
                } catch (error) {
                    // Submission is already approved; notification failure is non-fatal.
                }
                render();
                toast('KYC approved.');
            }
        });
    }

    function promptKycReject(key) {
        var submission = state.kyc[key];
        if (!submission) return;
        openModal({
            title: 'Reject KYC',
            bodyHtml: '<p>Reject the documents from <strong>' + esc(submission.userName || submission.userEmail || 'this user') + '</strong>.</p>' +
                '<label for="modal-reason">Reason</label><textarea id="modal-reason" placeholder="Explain what is wrong with the documents"></textarea>',
            confirmLabel: 'Reject',
            confirmClass: 'btn-danger',
            onConfirm: async function () {
                var reason = ($('#modal-reason').value || '').trim();
                if (!reason) throw new Error('Enter a rejection reason.');
                var now = Date.now();
                await dbPatch('KycSubmissions/' + enc(key), {
                    status: 'Rejected',
                    reviewedAt: now,
                    reviewedBy: 'Admin',
                    rejectionReason: reason
                });
                state.kyc[key] = Object.assign({}, submission, {
                    status: 'Rejected', reviewedAt: now, reviewedBy: 'Admin', rejectionReason: reason
                });
                try {
                    await createNotification(submission.userId, 'KYC Rejected',
                        'Your KYC verification was rejected. Reason: ' + reason, 'system', '');
                } catch (error) {
                    // Submission is already rejected; notification failure is non-fatal.
                }
                render();
                toast('KYC rejected.');
            }
        });
    }

    async function openThread(uid) {
        closeModal();
        state.view = 'support';
        state.supportUid = uid;
        try {
            window.location.hash = '#/' + state.view;
        } catch (error) {
            // Hash routing is optional.
        }
        render();
        try {
            await fetchThread(uid, true);
            render();
            startSupportPoll();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function closeThread() {
        state.supportUid = null;
        stopPoll();
        render();
        startSupportPoll();
    }

    async function sendSupportMessage() {
        var uid = state.supportUid;
        var input = $('#chat-input');
        if (!uid || !input) return;
        var text = String(input.value || '').trim();
        if (!text) return;
        var button = document.querySelector('[data-action="send-message"]');
        if (button) button.disabled = true;
        var key = 'm' + Date.now() + Math.random().toString(36).slice(2, 8);
        try {
            var message = {
                id: key,
                senderId: 'admin',
                senderName: 'Support Team',
                senderEmail: '',
                senderPhone: '',
                senderImage: '',
                message: text,
                timestamp: Date.now(),
                admin: true,
                isDelivered: false,
                isRead: false
            };
            await dbPut('support_messages/' + enc(uid) + '/' + enc(key), message);
            if (!state.support[uid]) state.support[uid] = {};
            state.support[uid][key] = message;
            input.value = '';
            updateChatMessages(uid);
            toast('Message sent.');
        } catch (error) {
            if (error && error.authFailure) {
                signOut(error.message);
                return;
            }
            toast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }

    function updateChatMessages(uid) {
        var container = $('#chat-messages');
        if (!container) return;
        var atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
        container.innerHTML = messagesHtml(uid);
        if (atBottom) container.scrollTop = container.scrollHeight;
    }

    function updatePresenceLabel(uid) {
        var label = $('#chat-presence');
        if (!label) return;
        var user = displayUser(uid);
        var presence = state.presence[uid];
        var online = presence && presence.online === true;
        label.textContent = (user.email || uid) + (online ? ' · Online' : ' · Offline');
        var header = document.querySelector('.chat-head strong');
        if (header) header.textContent = user.name;
    }

    function scrollChatToBottom() {
        var container = $('#chat-messages');
        if (container) container.scrollTop = container.scrollHeight;
    }

    function confirmRestoreProperty(key) {
        var property = state.properties[key];
        if (!property) return;
        openModal({
            title: 'Restore listing',
            bodyHtml: '<p>Move <strong>' + esc(property.title || 'this listing') + '</strong> back to pending review?</p>',
            confirmLabel: 'Restore',
            onConfirm: async function () {
                await dbPatch('Property/' + enc(key), { status: 'PENDING' });
                updateProperty(key, { status: 'PENDING' });
                render();
                toast('Listing restored to pending.');
            }
        });
    }

    function confirmDeleteProperty(key) {
        var property = state.properties[key];
        if (!property) return;
        var owner = ownerOf(property);
        openModal({
            title: 'Delete permanently',
            bodyHtml: '<p>Delete <strong>' + esc(property.title || 'this listing') + '</strong> from the database? This cannot be undone.</p>' +
                '<p>A record is written to deletion history first.</p>',
            confirmLabel: 'Delete permanently',
            confirmClass: 'btn-danger',
            onConfirm: async function () {
                var now = Date.now();
                var record = {
                    propertyId: property.id,
                    propertyTitle: property.title || '',
                    ownerName: owner.name,
                    ownerEmail: owner.email,
                    deletedDate: new Date(now).toLocaleString('en-US', {
                        month: 'short', day: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true
                    }),
                    deletedBy: 'Admin',
                    deletedTimestamp: now
                };
                await dbPost('DeletionHistory', record);
                await dbDelete('Property/' + enc(key));
                delete state.properties[key];
                await bestEffort(unpublishShareEntry(key));
                render();
                toast('Listing deleted.');
            }
        });
    }

    async function refreshAll(showToast) {
        if (!state.session) return;
        var generation = state.sessionGeneration;
        state.loadError = '';
        try {
            await Promise.all([loadCore(), loadSupport()]);
            if (!state.session || generation !== state.sessionGeneration) return;
            await bestEffort(syncSharedProperties());
            if (!state.session || generation !== state.sessionGeneration) return;
            state.loaded = true;
            state.loadedAt = Date.now();
            state.loadError = '';
            startRefreshTimer();
            render();
            if (showToast) toast('Data refreshed.');
        } catch (error) {
            if (!state.session || generation !== state.sessionGeneration) return;
            if (error && error.authFailure) {
                signOut(error.message);
                return;
            }
            state.loadError = error.message;
            render();
            if (showToast) toast('Refresh failed.', 'error');
        }
    }

    /* -------------------- Polling -------------------- */

    function stopPoll() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
    }

    function startSupportPoll() {
        stopPoll();
        if (state.view !== 'support' || !state.session) return;
        var interval = state.supportUid ? 8000 : 20000;
        state.pollTimer = setInterval(async function () {
            if (state.view !== 'support' || !state.session) return;
            try {
                if (state.supportUid) {
                    var uid = state.supportUid;
                    await fetchThread(uid, true);
                    if (state.supportUid !== uid) return;
                    updateChatMessages(uid);
                    updatePresenceLabel(uid);
                } else {
                    await loadSupport();
                    var list = $('#support-list');
                    if (list) list.innerHTML = supportListHtml();
                }
            } catch (error) {
                // Polling is best-effort; the next tick retries.
            }
        }, interval);
    }

    function stopRefreshTimer() {
        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }
    }

    function startRefreshTimer() {
        stopRefreshTimer();
        if (!state.session) return;
        state.refreshTimer = setInterval(function () {
            if (!state.session) {
                stopRefreshTimer();
                return;
            }
            updateSyncStatus();
            if (document.visibilityState && document.visibilityState === 'hidden') return;
            if (state.busy || !state.loadedAt || Date.now() - state.loadedAt < 60000) return;
            state.busy = true;
            refreshAll(false).catch(function () { }).then(function () { state.busy = false; });
        }, 30000);
    }

    /* -------------------- Auth UI -------------------- */

    function setLoginError(message) {
        var el = $('#login-error');
        if (!el) return;
        if (message) {
            el.textContent = message;
            el.hidden = false;
        } else {
            el.textContent = '';
            el.hidden = true;
        }
    }

    function showApp() {
        var login = $('#login-view');
        var app = $('#admin-view');
        if (login) login.hidden = true;
        if (app) app.hidden = false;
        var email = $('#account-email');
        if (email) email.textContent = state.session ? state.session.email || '' : '';
    }

    function showLogin(message) {
        var login = $('#login-view');
        var app = $('#admin-view');
        if (login) login.hidden = false;
        if (app) app.hidden = true;
        setLoginError(message || '');
        var email = $('#login-email');
        if (email) email.focus();
    }

    function signOut(message) {
        state.sessionGeneration += 1;
        stopPoll();
        stopRefreshTimer();
        state.busy = false;
        closeModal();
        clearKycObjectUrls();
        clearSession();
        state.session = null;
        state.loaded = false;
        state.busy = false;
        state.loadError = '';
        state.support = {};
        state.properties = {};
        state.users = {};
        state.reports = {};
        state.userReports = {};
        state.kyc = {};
        state.deletionHistory = {};
        state.presence = {};
        state.loadedAt = 0;
        state.ui.selected = {};
        state.globalResults = [];
        state.globalFocus = -1;
        state.supportUid = null;
        state.view = 'overview';
        try {
            window.location.hash = '#/overview';
        } catch (error) {
            // Hash routing is optional.
        }
        closeSidebar();
        var root = $('#view-root');
        if (root) root.innerHTML = '';
        showLogin(message);
    }

    async function handleLogin(event) {
        event.preventDefault();
        var email = ($('#login-email').value || '').trim();
        var password = $('#login-password').value || '';
        var button = $('#login-submit');
        setLoginError('');
        if (!email || !password) {
            setLoginError('Enter your email and password.');
            return;
        }
        button.disabled = true;
        button.textContent = 'Signing in…';
        try {
            await signIn(email, password);
            $('#login-password').value = '';
            state.view = initialView();
            state.loaded = false;
            state.supportUid = null;
            showApp();
            render();
            await refreshAll(false);
        } catch (error) {
            setLoginError(error.message || 'Sign in failed.');
            button.disabled = false;
            button.textContent = 'Sign in';
            return;
        }
        button.disabled = false;
        button.textContent = 'Sign in';
    }

    async function init() {
        var form = $('#login-form');
        if (form) form.addEventListener('submit', handleLogin);
        applyTheme(readPrefs().theme || 'system', false);

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('hashchange', function () {
                if (!state.session || !state.loaded) return;
                var next = initialView();
                if (next !== state.view) setView(next).catch(function () { });
            });
        }

        if (!API_KEY || !DB_URL) {
            showLogin('Firebase configuration is missing.');
            if (form) form.querySelector('button').disabled = true;
            return;
        }

        var saved = readSession();
        if (!saved || !isAdminToken(saved.idToken)) {
            clearSession();
            showLogin();
            return;
        }

        state.session = saved;
        state.view = initialView();
        showApp();
        render();
        try {
            await forceRefreshToken();
        } catch (error) {
            if (error && error.authFailure) {
                signOut(error.message);
                return;
            }
            // Keep the cached session and let requests surface the network error.
        }
        await refreshAll(false);
    }

    /* -------------------- Event wiring -------------------- */

    async function handleAction(action, element) {
        switch (action) {
            case 'nav':
                await setView(element.getAttribute('data-view'));
                return;
            case 'refresh':
                await refreshAll(true);
                return;
            case 'sign-out':
                signOut('');
                return;
            case 'toggle-sidebar':
                toggleSidebar();
                return;
            case 'toggle-theme':
                toggleTheme();
                return;
            case 'report-status':
                state.ui.reportStatus = element.getAttribute('data-status') || 'PENDING';
                render();
                return;
            case 'view-report-listing':
                openReportListing(element.getAttribute('data-key'));
                return;
            case 'view-report-user':
                openUserProfile(element.getAttribute('data-uid'));
                return;
            case 'show-shortcuts':
                showShortcuts();
                return;
            case 'select-listing':
                if (element.checked) state.ui.selected[element.getAttribute('data-key')] = true;
                else delete state.ui.selected[element.getAttribute('data-key')];
                renderListingResults();
                return;
            case 'select-all-listings':
                state.ui.selected = {};
                if (element.checked) {
                    visibleListings().forEach(function (property) { state.ui.selected[property._key] = true; });
                }
                renderListingResults();
                return;
            case 'bulk-clear':
                state.ui.selected = {};
                renderListingResults();
                return;
            case 'bulk-approve':
                bulkApprove();
                return;
            case 'bulk-reject':
                bulkReject();
                return;
            case 'report-tab':
                state.ui.reportTab = element.getAttribute('data-tab') === 'user' ? 'user' : 'listing';
                state.ui.reportQuery = '';
                render();
                return;
            case 'user-filter':
                state.ui.userFilter = element.getAttribute('data-filter') || 'all';
                writePrefs({ userFilter: state.ui.userFilter });
                render();
                return;
            case 'open-user':
                openUserProfile(element.getAttribute('data-uid'));
                return;
            case 'notify-user':
                promptNotifyUser(element.getAttribute('data-uid'));
                return;
            case 'send-broadcast':
                await sendBroadcast();
                return;
            case 'quick-reply':
                var replyInput = $('#chat-input');
                if (replyInput) {
                    replyInput.value = element.getAttribute('data-message') || '';
                    replyInput.focus();
                }
                return;
            case 'gs-pick':
                await chooseGlobalResult(state.globalResults[Number(element.getAttribute('data-index'))]);
                return;
            case 'listing-status':
                state.ui.listingStatus = element.getAttribute('data-status');
                render();
                return;
            case 'kyc-status':
                state.ui.kycStatus = element.getAttribute('data-status');
                render();
                return;
            case 'delete-tab':
                state.ui.deleteTab = element.getAttribute('data-tab');
                render();
                return;
            case 'toggle-details':
                toggleDetails(element.getAttribute('data-key'));
                return;
            case 'approve-listing':
                confirmApproveListing(element.getAttribute('data-key'));
                return;
            case 'reject-listing':
                promptRejectListing(element.getAttribute('data-key'));
                return;
            case 'sync-share-links':
                var shareSummary = await syncSharedProperties({ force: true });
                render();
                toast(shareSummary.failed
                    ? 'Share links: ' + shareSummary.written + ' updated, ' + shareSummary.removed + ' removed, ' + shareSummary.failed + ' failed.'
                    : 'Share links up to date: ' + shareSummary.written + ' updated, ' + shareSummary.removed + ' removed.',
                    shareSummary.failed ? 'error' : 'ok');
                return;
            case 'keep-report':
                confirmKeepReport(element.getAttribute('data-property'));
                return;
            case 'remove-report':
                confirmRemoveReport(element.getAttribute('data-property'));
                return;
            case 'suspend-user':
                promptSuspendUser(element.getAttribute('data-uid'));
                return;
            case 'activate-user':
                confirmActivateUser(element.getAttribute('data-uid'));
                return;
            case 'resolve-user':
                confirmResolveUser(element.getAttribute('data-uid'));
                return;
            case 'kyc-approve':
                confirmKycApprove(element.getAttribute('data-key'));
                return;
            case 'kyc-reject':
                promptKycReject(element.getAttribute('data-key'));
                return;
            case 'open-thread':
                await openThread(element.getAttribute('data-uid'));
                return;
            case 'close-thread':
                closeThread();
                return;
            case 'send-message':
                await sendSupportMessage();
                return;
            case 'restore-property':
                confirmRestoreProperty(element.getAttribute('data-key'));
                return;
            case 'delete-property':
                confirmDeleteProperty(element.getAttribute('data-key'));
                return;
            case 'open-image':
                openImage(element.getAttribute('data-src'));
                return;
            case 'open-kyc-image':
                if (element.getAttribute('data-src')) openImage(element.getAttribute('data-src'));
                return;
            case 'retry-kyc-image':
                if (state.kycAbortController) {
                    await loadProtectedKycImage(element, state.kycImageGeneration, state.kycAbortController.signal);
                }
                return;
            case 'close-modal':
                closeModal();
                return;
            default:
        }
    }

    document.addEventListener('click', function (event) {
        var wrap = $('#global-search-wrap');
        if (wrap && event.target && !wrap.contains(event.target)) closeGlobalResults();
        var element = event.target.closest('[data-action]');
        if (!element) return;
        var action = element.getAttribute('data-action');
        if (action === 'close-modal') {
            var isBackdrop = element.classList.contains('modal-backdrop');
            if (isBackdrop && event.target !== element) return;
            closeModal();
            return;
        }
        handleAction(action, element).catch(function (error) {
            if (error && error.authFailure) {
                signOut(error.message);
                return;
            }
            toast(error && error.message ? error.message : 'Something went wrong.', 'error');
        });
    });

    function rerenderKeepingFocus(id) {
        var current = $('#' + id);
        var caret = current && typeof current.selectionStart === 'number' ? current.selectionStart : null;
        render();
        var next = $('#' + id);
        if (next) {
            next.focus();
            if (caret != null && next.setSelectionRange) {
                try { next.setSelectionRange(caret, caret); } catch (error) { /* ignore */ }
            }
        }
    }

    document.addEventListener('input', function (event) {
        var target = event.target;
        if (!target || !target.id) return;
        if (target.id === 'listing-search') {
            state.ui.listingQuery = target.value;
            renderListingResults();
        } else if (target.id === 'search-properties') {
            state.ui.searchQuery = target.value;
            var results = $('#search-results');
            if (results) results.innerHTML = searchResultsHtml();
        } else if (target.id === 'delete-search') {
            state.ui.deleteQuery = target.value;
            renderDeleteResults();
        } else if (target.id === 'global-search') {
            state.globalResults = globalMatches(target.value);
            state.globalFocus = -1;
            renderGlobalResults();
        } else if (target.id === 'user-search') {
            state.ui.userQuery = target.value;
            rerenderKeepingFocus('user-search');
        } else if (target.id === 'kyc-search') {
            state.ui.kycQuery = target.value;
            renderKycResults();
        } else if (target.id === 'report-search') {
            state.ui.reportQuery = target.value;
            renderReportResults();
        } else if (target.id === 'support-search') {
            state.ui.supportQuery = target.value;
            var list = $('#support-list');
            if (list) list.innerHTML = supportListHtml();
        } else if (target.id === 'bc-title' || target.id === 'bc-message') {
            updateBroadcastCounters();
        }
    });

    document.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || !target.id) return;
        if (target.id === 'listing-sort') {
            state.ui.listingSort = target.value;
            writePrefs({ listingSort: target.value });
            renderListingResults();
        } else if (target.id === 'listing-market') {
            state.ui.listingMarket = target.value;
            renderListingResults();
        } else if (target.id === 'kyc-sort') {
            state.ui.kycSort = target.value;
            writePrefs({ kycSort: target.value });
            renderKycResults();
        } else if (target.id === 'report-sort') {
            state.ui.reportSort = target.value;
            renderReportResults();
        } else if (target.id === 'bc-audience' || target.id === 'bc-user') {
            updateBroadcastCounters();
        }
    });

    document.addEventListener('keydown', function (event) {
        var modalRoot = $('#modal-root');
        var target = event.target;
        var tag = target && target.tagName ? String(target.tagName).toUpperCase() : '';
        var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);

        if (event.key === '/' && !typing) {
            var search = $('#global-search');
            if (search) {
                event.preventDefault();
                search.focus();
            }
            return;
        }
        if (target && target.id === 'global-search') {
            if (event.key === 'Escape') {
                closeGlobalResults();
                target.blur();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (!state.globalResults.length) return;
                event.preventDefault();
                state.globalFocus = event.key === 'ArrowDown'
                    ? (state.globalFocus + 1) % state.globalResults.length
                    : (state.globalFocus <= 0 ? state.globalResults.length - 1 : state.globalFocus - 1);
                renderGlobalResults();
                return;
            }
            if (event.key === 'Enter' && state.globalFocus >= 0) {
                event.preventDefault();
                chooseGlobalResult(state.globalResults[state.globalFocus]).catch(function (error) {
                    toast(error && error.message ? error.message : 'Could not open that result.', 'error');
                });
                return;
            }
        }
        if (event.key === 'Escape' && modalRoot && modalRoot.children.length) {
            closeModal();
            return;
        }
        if (event.key === 'r' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey && !(modalRoot && modalRoot.children.length)) {
            state.ui.selected = {};
            refreshAll(true);
            return;
        }
        if (event.target && event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendSupportMessage().catch(function (error) {
                toast(error && error.message ? error.message : 'Could not send the message.', 'error');
            });
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            init().catch(function (error) {
                showLogin(error && error.message ? error.message : 'Could not start the admin console.');
            });
        });
    } else {
        init().catch(function (error) {
            showLogin(error && error.message ? error.message : 'Could not start the admin console.');
        });
    }
}());
