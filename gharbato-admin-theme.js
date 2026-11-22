/* Applies the stored admin theme before first paint so there is no flash.
 * Kept in its own file because the site's CSP only allows scripts from 'self'. */
(function () {
    'use strict';
    try {
        var prefs = JSON.parse(localStorage.getItem('gharbato-admin-prefs-v1') || '{}');
        var theme = prefs.theme || 'system';
        var dark = theme === 'dark' || (theme !== 'light' &&
            window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    } catch (error) {
        document.documentElement.setAttribute('data-theme', 'light');
    }
}());
