// Service worker mínimo (sem cache), só para o navegador considerar o app instalável
// e abrir em modo standalone depois de instalado.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {});
