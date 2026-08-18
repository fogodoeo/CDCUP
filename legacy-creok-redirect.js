(function redirectLegacyCdcupHost() {
    'use strict';
    const host = String(location.hostname || '').toLowerCase();
    if (host !== 'cdcup.onrender.com' && host !== 'www.cdcup.onrender.com') return;
    const routes = {
        '/': '/cdcup-index.html',
        '/index.html': '/cdcup-index.html',
        '/cdcup': '/cdcup-index.html',
        '/cdcup/': '/cdcup-index.html',
        '/cdcup/index.html': '/cdcup-index.html'
    };
    const path = routes[location.pathname] || location.pathname;
    location.replace(`https://creok.onrender.com${path}${location.search}${location.hash}`);
}());
