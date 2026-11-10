/* GitHub Pages /tanaka-organ/ 内の資材だけを対象にする。オンライン優先・オフライン時キャッシュ利用。 */
const CACHE_NAME='tanaka-organ-ipad-2026-11-10-touch-keyheight-v13';
const FILES=['./','./index.html','./style.css','./app.js','./README.txt'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tanaka-organ-ipad-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const scopePath=new URL('./',self.registration.scope).pathname;
  if(url.origin!==self.location.origin||!url.pathname.startsWith(scopePath))return;
  event.respondWith((async()=>{
    try {
      const response=await fetch(event.request);
      if(response.ok){
        const cache=await caches.open(CACHE_NAME);
        await cache.put(event.request,response.clone());
        return response;
      }
      const cached=await caches.match(event.request);
      return cached||response;
    }catch(err){
      const cached=await caches.match(event.request);
      if(cached)return cached;
      if(event.request.mode==='navigate'){
        const home=await caches.match('./index.html');
        if(home)return home;
      }
      throw err;
    }
  })());
});
