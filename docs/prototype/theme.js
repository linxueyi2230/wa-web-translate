(function () {
    'use strict';
    const H = window.Haomai;
    H.publicLinks = { website: '', appDownload: '', extensionInstall: '' };
    H.createTheme = function (state, render) {
        const key = 'haomai.prototype.' + state.platform + '.theme';
        const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
        let mode = 'system';
        try { mode = localStorage.getItem(key) || mode; } catch (_) {}
        const requested = new URLSearchParams(location.search).get('theme');
        if (['dark', 'light', 'system'].includes(requested)) mode = requested;
        function apply(value, notify) {
            state.themeMode = ['dark', 'light', 'system'].includes(value) ? value : 'system';
            state.theme = state.themeMode === 'system' ? media.matches ? 'dark' : 'light' : state.themeMode;
            document.body.dataset.theme = state.theme;
            if (notify) render();
        }
        if (media.addEventListener) media.addEventListener('change', function () { if (state.themeMode === 'system') apply('system', true); });
        apply(mode, false);
        return { set: function (value) { try { localStorage.setItem(key, value); } catch (_) {} apply(value, true); } };
    };
})();
