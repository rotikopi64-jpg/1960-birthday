// /tts?text=..&lang=ko|zh|en → audio/mpeg via Workers AI MeloTTS. Every other path is a static asset (public/).
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname !== '/tts') return new Response('Not found', { status: 404 });
    const text = (u.searchParams.get('text') || '').trim().slice(0, 40);   // ponytail: public endpoint, length cap is the only abuse guard
    const lang = { ko: 'kr', zh: 'zh', en: 'en' }[u.searchParams.get('lang')] || 'en';   // MeloTTS codes
    if (!text) return new Response('text required', { status: 400 });
    const hit = await caches.default.match(req);
    if (hit) return hit;
    let r;
    try { r = await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang }); }
    catch (e) { return new Response('AI error: ' + (e.message || e), { status: 502 }); }
    if (!r?.audio && !(r instanceof ReadableStream) && !(r instanceof ArrayBuffer))
      return new Response('unexpected: ' + JSON.stringify(r).slice(0, 300), { status: 502 });
    const body = r.audio ? Uint8Array.from(atob(r.audio), c => c.charCodeAt(0)) : r;
    const res = new Response(body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000' } });
    ctx.waitUntil(caches.default.put(req, res.clone()));
    return res;
  }
};
