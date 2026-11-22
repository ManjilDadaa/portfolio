/**
 * GharBato shared listing page.
 *
 * Reads the public projection at SharedProperties/<key> (written by the admin
 * console, see share-worker/README.md for the field contract). This page is the
 * static fallback; when the share worker is deployed, /p/<key> serves the same
 * data with server-rendered Open Graph tags.
 */
(function () {
    'use strict';

    var CONFIG = {
        databaseUrl: 'https://gharbatodb-default-rtdb.firebaseio.com',
        siteOrigin: 'https://manjilbasnet.com.np',
        sharePath: '/p',
        appPackage: 'com.gharbato.nepal.mobile',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=com.gharbato.nepal.mobile',
        // Flip to true once the Play Store listing is published.
        playStoreLive: false
    };

    var KEY_PATTERN = /^-?[A-Za-z0-9_-]{1,64}$/;
    var IMAGE_HOSTS = ['res.cloudinary.com', 'lh3.googleusercontent.com'];
    var REQUEST_TIMEOUT = 9000;

    var $ = function (id) { return document.getElementById(id); };

    function keyFromLocation() {
        var params = new URLSearchParams(window.location.search);
        var raw = params.get('id') || params.get('key') || '';
        if (!raw) {
            var match = window.location.pathname.match(/\/p\/([^/]+)\/?$/);
            if (match) raw = decodeURIComponent(match[1]);
        }
        raw = String(raw).trim();
        return KEY_PATTERN.test(raw) ? raw : '';
    }

    function text(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function oneLine(value, limit) {
        var out = text(value).replace(/\s+/g, ' ');
        return limit && out.length > limit ? out.slice(0, limit - 1).trimEnd() + '…' : out;
    }

    function safeImage(value) {
        var raw = text(value);
        if (!raw) return '';
        var url;
        try {
            url = new URL(raw);
        } catch (error) {
            return '';
        }
        if (url.protocol !== 'https:') return '';
        return IMAGE_HOSTS.indexOf(url.hostname) === -1 ? '' : url.toString();
    }

    function sizedImage(value, transform) {
        var url = safeImage(value);
        if (!url) return '';
        var index = url.indexOf('/upload/');
        if (url.indexOf('res.cloudinary.com/') === -1 || index === -1) return url;
        var head = url.slice(0, index + 8);
        var tail = url.slice(index + 8).replace(/^(?:[a-z]{1,2}_[^/]+\/)+/i, '');
        return head + transform + '/' + tail;
    }

    function imageList(raw) {
        var out = [];
        var push = function (value) {
            var safe = safeImage(value);
            if (safe && out.indexOf(safe) === -1 && out.length < 8) out.push(safe);
        };
        if (Array.isArray(raw)) {
            raw.forEach(push);
        } else if (raw && typeof raw === 'object') {
            if (Array.isArray(raw.cover)) raw.cover.forEach(push); else push(raw.cover);
            Object.keys(raw).forEach(function (category) {
                if (category === 'cover') return;
                if (Array.isArray(raw[category])) raw[category].forEach(push); else push(raw[category]);
            });
        }
        return out;
    }

    function formatPrice(value) {
        var raw = oneLine(value, 60);
        if (!raw) return 'Price on request';
        var match = raw.match(/\b(?:npr|rs\.?|रु\.?)\s*([0-9][0-9,.]*)/i);
        if (match) return 'NPR ' + match[1];
        return /^[0-9][0-9,.\s]*$/.test(raw) ? 'NPR ' + raw : raw;
    }

    function plural(count, noun) {
        var value = Number(count) || 0;
        return value + ' ' + noun + (value === 1 ? '' : 's');
    }

    function facts(property) {
        var out = [];
        if (property.bedrooms > 0) out.push(plural(property.bedrooms, 'bed'));
        if (property.bathrooms > 0) out.push(plural(property.bathrooms, 'bath'));
        if (text(property.sqft)) out.push(oneLine(property.sqft, 40));
        if (text(property.furnishing)) out.push(oneLine(property.furnishing, 40));
        if (property.parking === true) out.push('Parking');
        if (property.petsAllowed === true) out.push('Pets allowed');
        return out;
    }

    function canonicalUrl(key) {
        return CONFIG.siteOrigin + CONFIG.sharePath + '/' + encodeURIComponent(key);
    }

    function setMeta(selector, value) {
        var node = document.querySelector(selector);
        if (node) node.setAttribute('content', value);
    }

    function applyMetadata(property) {
        var title = property.title + ' — ' + formatPrice(property.price) + ' | GharBato';
        var location = oneLine(property.location, 120);
        var description = oneLine([
            formatPrice(property.price),
            text(property.marketType),
            text(property.propertyType),
            location,
            text(property.description)
        ].filter(Boolean).join(' · '), 200) || 'A property shared from GharBato.';
        document.title = title;
        setMeta('meta[name="description"]', description);
        setMeta('meta[property="og:title"]', title);
        setMeta('meta[property="og:description"]', description);
        setMeta('meta[property="og:url"]', canonicalUrl(property.key));
        setMeta('meta[name="twitter:title"]', title);
        setMeta('meta[name="twitter:description"]', description);
        var image = sizedImage(imageList(property.images)[0] || '', 'c_fill,w_1200,h_630,q_70,f_jpg');
        if (image) {
            setMeta('meta[property="og:image"]', image);
            setMeta('meta[name="twitter:image"]', image);
        }
    }

    function showState(title, message, options) {
        $('share-loading').hidden = true;
        $('share-card').hidden = true;
        $('share-state').hidden = false;
        $('share-state-title').textContent = title;
        $('share-state-message').textContent = message;
        $('share-retry').hidden = !(options && options.retry);
    }

    function hideStates() {
        $('share-loading').hidden = true;
        $('share-state').hidden = true;
        $('share-card').hidden = false;
    }

    function renderGallery(property) {
        var gallery = $('share-gallery');
        gallery.textContent = '';
        var images = imageList(property.images);
        if (!images.length) {
            var empty = document.createElement('div');
            empty.className = 'share-gallery__empty';
            empty.textContent = 'Photos are available in the app';
            gallery.appendChild(empty);
            return;
        }
        var hero = new Image();
        hero.src = sizedImage(images[0], 'c_fill,w_960,h_720,q_75,f_auto');
        hero.alt = property.title + (text(property.location) ? ' in ' + text(property.location) : '');
        hero.loading = 'eager';
        hero.decoding = 'async';
        gallery.appendChild(hero);

        var rest = images.slice(1, 4);
        if (rest.length) {
            gallery.classList.add('has-thumbs');
            var thumbs = document.createElement('div');
            thumbs.className = 'share-gallery__thumbs';
            rest.forEach(function (url) {
                var thumb = new Image();
                thumb.src = sizedImage(url, 'c_fill,w_480,h_360,q_70,f_auto');
                thumb.alt = '';
                thumb.loading = 'lazy';
                thumb.decoding = 'async';
                thumbs.appendChild(thumb);
            });
            gallery.appendChild(thumbs);
        }
    }

    function renderFacts(property) {
        var list = $('share-facts');
        list.textContent = '';
        facts(property).forEach(function (item) {
            var li = document.createElement('li');
            li.textContent = item;
            list.appendChild(li);
        });
    }

    function renderDescription(property) {
        var section = $('share-description-section');
        var container = $('share-description');
        var raw = text(property.description);
        container.textContent = '';
        section.hidden = !raw;
        if (!raw) return;
        raw.split(/\n{2,}/).slice(0, 12).forEach(function (paragraph) {
            var p = document.createElement('p');
            p.textContent = paragraph.trim();
            container.appendChild(p);
        });
    }

    function renderDetails(property) {
        var rows = [
            ['Floor', property.floor],
            ['Furnishing', property.furnishing],
            ['Total rooms', property.totalRooms],
            ['Kitchen', property.kitchen],
            ['Available from', property.availableFrom],
            ['Minimum lease', property.minimumLease],
            ['Advance payment', property.advancePayment],
            ['Security deposit', property.securityDeposit],
            ['Utilities', property.utilitiesIncluded],
            ['Commission', property.commission]
        ].filter(function (row) { return text(row[1]); });

        var section = $('share-details-section');
        var list = $('share-details');
        list.textContent = '';
        section.hidden = rows.length === 0;
        rows.forEach(function (row) {
            var wrapper = document.createElement('div');
            var dt = document.createElement('dt');
            var dd = document.createElement('dd');
            dt.textContent = row[0];
            dd.textContent = oneLine(row[1], 200);
            wrapper.appendChild(dt);
            wrapper.appendChild(dd);
            list.appendChild(wrapper);
        });
    }

    function renderAmenities(property) {
        var section = $('share-amenities-section');
        var list = $('share-amenities');
        list.textContent = '';
        var items = Array.isArray(property.amenities) ? property.amenities.filter(function (item) {
            return text(item);
        }).slice(0, 20) : [];
        section.hidden = items.length === 0;
        items.forEach(function (item) {
            var li = document.createElement('li');
            li.textContent = oneLine(item, 80);
            list.appendChild(li);
        });
    }

    function renderOwner(property) {
        var section = $('share-owner-section');
        var name = oneLine(property.ownerName, 200);
        section.hidden = !name;
        if (!name) return;
        $('share-owner-name').textContent = name;
        var avatar = $('share-owner-avatar');
        avatar.textContent = '';
        var image = sizedImage(property.ownerImageUrl, 'c_fill,w_88,h_88,q_70');
        if (image) {
            var img = new Image();
            img.src = image;
            img.alt = '';
            avatar.appendChild(img);
        } else {
            avatar.textContent = name.slice(0, 1).toUpperCase();
        }
    }

    function renderUpdated(property) {
        var node = $('share-updated');
        var stamp = Number(property.updatedAt);
        if (!stamp || Number.isNaN(stamp)) {
            node.textContent = '';
            return;
        }
        var formatted;
        try {
            formatted = new Date(stamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (error) {
            formatted = '';
        }
        node.textContent = formatted
            ? 'Listing updated ' + formatted + '. Price and availability can change.'
            : '';
    }

    function renderActions(property) {
        var link = canonicalUrl(property.key);
        var shareText = [property.title, formatPrice(property.price), oneLine(property.location, 120)]
            .filter(Boolean).join('\n');

        $('share-copy').onclick = function () { copyLink(link); };

        var whatsapp = $('share-whatsapp');
        whatsapp.href = 'https://wa.me/?text=' + encodeURIComponent(shareText + '\n' + link);

        var getApp = $('share-get-app');
        if (CONFIG.playStoreLive) {
            getApp.href = CONFIG.playStoreUrl;
            getApp.textContent = 'Get GharBato';
            getApp.hidden = false;
        }

        var openApp = $('share-open-app');
        var isAndroid = /android/i.test(navigator.userAgent || '');
        if (isAndroid) {
            var fallback = CONFIG.playStoreLive ? CONFIG.playStoreUrl : link;
            openApp.href = 'intent://' + CONFIG.siteOrigin.replace(/^https?:\/\//, '') +
                CONFIG.sharePath + '/' + encodeURIComponent(property.key) +
                '#Intent;scheme=https;package=' + CONFIG.appPackage +
                ';S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end';
            openApp.hidden = false;
        }

        $('share-note').textContent = CONFIG.playStoreLive
            ? 'Owner contact, exact location and reporting tools live in the GharBato app.'
            : 'GharBato is coming soon to Google Play. This page is a public preview of the listing.';

        var actions = $('share-actions');
        var existingNative = actions.querySelector('.share-native');
        if (existingNative) existingNative.remove();
        if (navigator.share) {
            var nativeButton = document.createElement('button');
            nativeButton.type = 'button';
            nativeButton.className = 'share-button share-button--quiet share-native';
            nativeButton.textContent = 'Share';
            nativeButton.addEventListener('click', function () {
                navigator.share({ title: property.title, text: shareText, url: link }).catch(function () {});
            });
            actions.appendChild(nativeButton);
        }
    }

    function copyLink(link) {
        var done = function () { toast('Link copied'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(done).catch(function () { fallbackCopy(link, done); });
        } else {
            fallbackCopy(link, done);
        }
    }

    function fallbackCopy(link, done) {
        var field = document.createElement('textarea');
        field.value = link;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        try {
            document.execCommand('copy');
            done();
        } catch (error) {
            toast('Copy failed — long-press the address bar');
        }
        document.body.removeChild(field);
    }

    var toastTimer = 0;

    function toast(message) {
        var node = $('share-toast');
        node.textContent = message;
        node.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { node.hidden = true; }, 2200);
    }

    function render(property) {
        hideStates();
        renderGallery(property);
        $('share-title').textContent = property.title;
        $('share-price').textContent = formatPrice(property.price);
        $('share-subtitle').textContent = [text(property.marketType), text(property.propertyType)]
            .filter(Boolean).join(' · ');
        var location = oneLine(property.location, 160);
        $('share-location').textContent = location;
        $('share-location').hidden = !location;
        renderFacts(property);
        renderDescription(property);
        renderDetails(property);
        renderAmenities(property);
        renderOwner(property);
        renderUpdated(property);
        renderActions(property);
        applyMetadata(property);
    }

    function load() {
        var key = keyFromLocation();
        if (!key) {
            showState('This share link is incomplete',
                'The property reference is missing or malformed. Open the listing from the GharBato app and try sharing it again.',
                { retry: false });
            return;
        }
        $('share-loading').hidden = false;
        $('share-state').hidden = true;
        $('share-card').hidden = true;

        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT) : 0;

        fetch(CONFIG.databaseUrl + '/SharedProperties/' + encodeURIComponent(key) + '.json', {
            cache: 'no-store',
            signal: controller ? controller.signal : undefined
        }).then(function (response) {
            return response.json().catch(function () { return null; });
        }).then(function (data) {
            clearTimeout(timer);
            if (!data || typeof data !== 'object' || !text(data.title)) {
                showState('This listing is no longer available',
                    'It may have been rented, sold, removed by the owner, or is still waiting for review.',
                    { retry: false });
                return;
            }
            data.key = key;
            render(data);
        }).catch(function () {
            clearTimeout(timer);
            showState('We could not load this listing',
                'Check your connection and try again.', { retry: true });
        });
    }

    $('share-retry').addEventListener('click', load);
    load();
}());
