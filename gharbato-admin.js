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
        users: {},
        reports: {},
        userReports: {},
        kyc: {},
        deletionHistory: {},
        support: {},
        presence: {},
        supportUid: null,
        pollTimer: null,
        ui: {
            listingStatus: 'PENDING',
            listingQuery: '',
            kycStatus: 'Pending',
            deleteTab: 'rejected',
            deleteQuery: '',
            searchQuery: ''
        }
    };

    var memorySession = null;

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

    async function dbRequest(path, options) {
        options = options || {};
        var token = options.token || await getToken();
        var url = DB_URL + '/' + path + '.json?auth=' + enc(token);
        var init = { method: options.method || 'GET', cache: 'no-store' };
        if (options.body !== undefined) {
            init.headers = { 'Content-Type': 'application/json' };
            init.body = JSON.stringify(options.body);
        }
        var response;
        try {
            response = await fetch(url, init);
        } catch (error) {
            throw new Error('Network error. Check your connection.');
        }
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
        var results = await Promise.all([
            dbRequest('Property'),
            dbRequest('Users'),
            dbRequest('ReportedProperties'),
            dbRequest('user_reports'),
            dbRequest('KycSubmissions'),
            dbRequest('DeletionHistory')
        ]);
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
    }

    async function loadSupport() {
        state.support = mapValues(await dbRequest('support_messages'));
    }

    async function fetchThread(uid, withPresence) {
        var thread = mapValues(await dbRequest('support_messages/' + enc(uid)));
        state.support[uid] = thread;
        if (withPresence) {
            try {
                state.presence[uid] = await dbRequest('user_presence/' + enc(uid));
            } catch (error) {
                state.presence[uid] = null;
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

    function overviewView() {
        var properties = propertyList();
        var pending = properties.filter(function (property) { return property.status === 'PENDING'; });
        var reports = pendingPropertyReports();
        var users = groupedUserReports();
        var pendingKyc = Object.keys(state.kyc).filter(function (key) {
            return state.kyc[key] && state.kyc[key].status === 'Pending';
        }).length;
        var threads = supportThreads().length;

        var recentPending = pending.slice(0, 5).map(function (property) {
            var owner = ownerOf(property);
            return '<div class="panel-row"><div class="grow"><strong>' + esc(property.title || 'Untitled listing') + '</strong>' +
                '<span>' + esc(owner.name) + ' · ' + esc(fmtTs(property.createdAt)) + '</span></div>' +
                badge(property.status) + '</div>';
        }).join('');

        var recentReports = reports.slice(0, 5).map(function (report) {
            return '<div class="panel-row"><div class="grow"><strong>' + esc(report.propertyTitle || 'Listing') + '</strong>' +
                '<span>' + esc(report.reportReason || 'Reported listing') + ' · ' + esc(fmtTs(report.reportedAt)) + '</span></div>' +
                '<span class="badge badge-pending">Report</span></div>';
        }).join('');

        return '<section class="page-head"><div><h1>Overview</h1><p>Everything that needs attention across GharBato.</p></div></section>' +
            '<div class="stat-grid">' +
            statButton('listings', 'Pending listings', pending.length, 'is-warn') +
            statButton('reports', 'Open reports', reports.length + users.length, 'is-danger') +
            statButton('kyc', 'Pending KYC', pendingKyc, 'is-good') +
            statButton('support', 'Support conversations', threads, '') +
            '</div>' +
            '<div class="panel-grid">' +
            '<section class="panel"><h2>Newest pending listings</h2><div class="panel-list">' +
            (recentPending || '<p class="muted small">Nothing waiting for review.</p>') +
            '</div></section>' +
            '<section class="panel"><h2>Latest reports</h2><div class="panel-list">' +
            (recentReports || '<p class="muted small">No open reports.</p>') +
            '</div></section>' +
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
        return '<article class="listing-card">' +
            '<div class="listing-media">' + media + '</div>' +
            '<div class="listing-body">' +
            '<div class="row-between"><h3>' + esc(property.title || 'Untitled listing') + '</h3>' + (options.status === false ? '' : badge(property.status)) + '</div>' +
            '<p class="meta">' + esc(price) + ' · ' + esc(property.propertyType || 'Property') + ' · ' + esc(property.location || 'No location') + '</p>' +
            '<div class="owner">' + avatarHtml(owner.image, owner.name) +
            '<div class="owner-text"><strong>' + esc(owner.name) + '</strong><span>' + esc(owner.email || 'No email') + '</span></div></div>' +
            actions + propertyDetailsHtml(Object.assign({ _key: key }, property)) +
            '</div></article>';
    }

    function renderListingResults() {
        var container = $('#listing-results');
        if (!container) return;
        var query = state.ui.listingQuery.trim().toLowerCase();
        var items = propertyList().filter(function (property) {
            return property.status === state.ui.listingStatus;
        }).filter(function (property) {
            if (!query) return true;
            var owner = ownerOf(property);
            return [property.title, property.location, property.developer, property.propertyType, owner.name, owner.email]
                .join(' ').toLowerCase().indexOf(query) !== -1;
        });
        var html = items.map(function (property) {
            var key = property._key;
            return propertyCard(property, key, { actions: state.ui.listingStatus === 'PENDING' });
        }).join('');
        container.innerHTML = html || '<div class="empty">No ' + esc(state.ui.listingStatus.toLowerCase()) + ' listings match this view.</div>';
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
        return '<section class="page-head"><div><h1>Listings</h1><p>Review, approve, and track every listing.</p></div></section>' +
            '<div class="toolbar"><div class="search"><input id="listing-search" type="search" placeholder="Search title, owner, location…" value="' + esc(state.ui.listingQuery) + '"></div>' +
            '<div class="segmented">' + tabs + '</div></div>' +
            '<div class="stack" id="listing-results"></div>';
    }

    function reportCard(report) {
        var propertyId = report.propertyId;
        var image = imageUrl(report.propertyImage);
        var media = image
            ? imgTag(image, report.propertyTitle || 'Reported listing', '')
            : '<span class="placeholder">No photo</span>';
        return '<article class="listing-card">' +
            '<div class="listing-media">' + media + '</div>' +
            '<div class="listing-body">' +
            '<div class="row-between"><h3>' + esc(report.propertyTitle || 'Listing #' + propertyId) + '</h3>' +
            '<span class="badge badge-pending">Reported</span></div>' +
            '<p class="meta">Owner: ' + esc(report.ownerName || 'Unknown') + ' · Reported ' + esc(fmtTs(report.reportedAt)) + '</p>' +
            '<div class="reason-box"><strong>Reason</strong>' + esc(report.reportReason || 'No reason provided') +
            (report.reportDetails ? '<br>' + esc(report.reportDetails) : '') + '</div>' +
            '<div class="owner"><span class="avatar-fallback">' + esc(initials(report.reportedByName || 'Anonymous')) + '</span>' +
            '<div class="owner-text"><strong>' + esc(report.reportedByName || 'Anonymous') + '</strong><span>Reporter</span></div></div>' +
            '<div class="actions">' +
            '<button type="button" class="btn btn-ghost btn-small" data-action="keep-report" data-property="' + esc(propertyId) + '">Keep listing</button>' +
            '<button type="button" class="btn btn-danger btn-small" data-action="remove-report" data-property="' + esc(propertyId) + '">Remove listing</button>' +
            '</div></div></article>';
    }

    function reportsView() {
        var reports = pendingPropertyReports();
        return '<section class="page-head"><div><h1>Reported listings</h1><p>Reports filed by users, grouped by listing.</p></div></section>' +
            (reports.length ? '<div class="stack">' + reports.map(reportCard).join('') + '</div>'
                : '<div class="empty">No open listing reports.</div>');
    }

    function userReportCard(group) {
        var user = group.user;
        var statusBadge = user.suspended ? badge('SUSPENDED') : badge('ACTIVE');
        var suspension = user.suspended
            ? '<p class="meta">Until ' + esc(fmtTs(user.suspendedUntil)) + (user.suspensionReason ? ' · ' + esc(user.suspensionReason) : '') + '</p>'
            : '';
        return '<article class="listing-card" style="grid-template-columns:1fr">' +
            '<div class="listing-body">' +
            '<div class="row-between"><div class="owner" style="margin-top:0">' + avatarHtml(user.image, user.name) +
            '<div class="owner-text"><strong>' + esc(user.name) + '</strong><span>' + esc(user.email || user.uid) + '</span></div></div>' +
            statusBadge + '</div>' +
            '<p class="meta">' + group.reports.length + ' report' + (group.reports.length === 1 ? '' : 's') + ' · Latest ' + esc(fmtTs(group.latest.timestamp)) + '</p>' +
            '<div class="reason-box"><strong>Latest reason</strong>' + esc(group.latest.reason || 'No reason provided') + '</div>' +
            suspension +
            '<div class="actions">' +
            (user.suspended
                ? '<button type="button" class="btn btn-ghost btn-small" data-action="activate-user" data-uid="' + esc(group.uid) + '">Activate</button>'
                : '<button type="button" class="btn btn-danger btn-small" data-action="suspend-user" data-uid="' + esc(group.uid) + '">Suspend</button>') +
            '<button type="button" class="btn btn-ghost btn-small" data-action="resolve-user" data-uid="' + esc(group.uid) + '">Resolve reports</button>' +
            '</div></div></article>';
    }

    function usersView() {
        var groups = groupedUserReports();
        return '<section class="page-head"><div><h1>Reported users</h1><p>Accounts flagged by users, grouped by account.</p></div></section>' +
            (groups.length ? '<div class="stack">' + groups.map(userReportCard).join('') + '</div>'
                : '<div class="empty">No reported users.</div>');
    }

    function kycCard(key, submission) {
        var front = imageUrl(submission.frontImageUrl);
        var back = imageUrl(submission.backImageUrl);
        var docs = '';
        if (front || back) {
            docs = '<div class="doc-pair">' +
                (front ? '<button type="button" data-action="open-image" data-src="' + esc(front) + '">' + imgTag(front, 'Front of document', '') + '</button>' : '') +
                (back ? '<button type="button" data-action="open-image" data-src="' + esc(back) + '">' + imgTag(back, 'Back of document', '') + '</button>' : '') +
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
        var visible = submissions.filter(function (item) { return item.value.status === state.ui.kycStatus; });
        return '<section class="page-head"><div><h1>KYC verification</h1><p>Review identity documents submitted by users.</p></div></section>' +
            '<div class="toolbar"><div class="segmented">' + tabs + '</div></div>' +
            (visible.length ? '<div class="stack">' + visible.map(function (item) { return kycCard(item.key, item.value); }).join('') + '</div>'
                : '<div class="empty">No ' + esc(state.ui.kycStatus.toLowerCase()) + ' KYC submissions.</div>');
    }

    function supportListHtml() {
        var threads = supportThreads();
        if (!threads.length) return '<div class="empty">No support conversations yet.</div>';
        return '<div class="thread-list">' + threads.map(function (thread) {
            var user = thread.user;
            return '<button type="button" class="thread" data-action="open-thread" data-uid="' + esc(thread.uid) + '">' +
                avatarHtml(user.image, user.name) +
                '<div class="grow"><strong>' + esc(user.name) + '</strong><span>' + esc(user.email || thread.uid) + '</span>' +
                '<span>' + esc(thread.last.message || '') + '</span></div>' +
                '<span class="muted small">' + esc(fmtTs(thread.last.timestamp)) + '</span></button>';
        }).join('') + '</div>';
    }

    function supportView() {
        if (state.supportUid) {
            var uid = state.supportUid;
            var user = displayUser(uid);
            var presence = state.presence[uid];
            var online = presence && presence.online === true;
            return '<section class="page-head"><div><h1>Support</h1><p>Reply to the user directly from the web console.</p></div></section>' +
                '<div class="chat-shell"><div class="chat-head">' +
                '<button type="button" class="btn btn-ghost btn-small" data-action="close-thread">Back</button>' +
                avatarHtml(user.image, user.name) +
                '<div class="grow"><strong>' + esc(user.name) + '</strong><span id="chat-presence">' + esc(user.email || uid) + (online ? ' · Online' : ' · Offline') + '</span></div>' +
                '</div><div class="chat-messages" id="chat-messages">' + messagesHtml(uid) + '</div>' +
                '<div class="composer"><textarea id="chat-input" rows="1" placeholder="Write a reply…"></textarea>' +
                '<button type="button" class="btn btn-primary" data-action="send-message">Send</button></div></div>';
        }
        return '<section class="page-head"><div><h1>Support</h1><p>All conversations started from the app.</p></div></section>' +
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
            case 'search': html += searchView(); break;
            case 'delete': html += deleteView(); break;
            default: html += overviewView(); break;
        }
        root.innerHTML = html;
        if (state.view === 'listings') renderListingResults();
        if (state.view === 'support' && state.supportUid) scrollChatToBottom();
    }

    function updateTabs() {
        var tabs = document.querySelectorAll('.tab[data-view]');
        for (var i = 0; i < tabs.length; i += 1) {
            tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-view') === state.view);
        }
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
        var url = imageUrl(src);
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

    async function setView(view) {
        if (!view) return;
        state.view = view;
        state.supportUid = view === 'support' ? state.supportUid : null;
        stopPoll();
        state.loadError = '';
        if (view === 'support') {
            try {
                await loadSupport();
            } catch (error) {
                state.loadError = error.message;
            }
        }
        render();
        if (view === 'support') startSupportPoll();
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
        state.supportUid = uid;
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
                render();
                toast('Listing deleted.');
            }
        });
    }

    async function refreshAll(showToast) {
        if (!state.session) return;
        state.loadError = '';
        try {
            await Promise.all([loadCore(), loadSupport()]);
            state.loaded = true;
            render();
            if (showToast) toast('Data refreshed.');
        } catch (error) {
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
        stopPoll();
        closeModal();
        clearSession();
        state.session = null;
        state.loaded = false;
        state.busy = false;
        state.loadError = '';
        state.support = {};
        state.presence = {};
        state.supportUid = null;
        state.view = 'overview';
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
            state.view = 'overview';
            state.loaded = false;
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
            case 'close-modal':
                closeModal();
                return;
            default:
        }
    }

    document.addEventListener('click', function (event) {
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
        }
    });

    document.addEventListener('keydown', function (event) {
        var modalRoot = $('#modal-root');
        if (event.key === 'Escape' && modalRoot && modalRoot.children.length) {
            closeModal();
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
