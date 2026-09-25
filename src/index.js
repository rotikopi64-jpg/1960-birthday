// /tts?text=..&lang=ko|zh|en → audio/mpeg. MeloTTS (multilingual) first; if it fails, Deepgram Aura (English) with the
// name romanized, so a Korean-typed name still gets sung. Every other path is a static asset (public/).
const CHO = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const JUNG = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const JONG = ['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];
const roman = s => s.replace(/[가-힣]/g, ch => { const c = ch.charCodeAt(0) - 0xAC00; return CHO[Math.floor(c / 588)] + JUNG[Math.floor(c % 588 / 28)] + JONG[c % 28]; });

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname !== '/tts') return new Response('Not found', { status: 404 });
    const text = (u.searchParams.get('text') || '').trim().slice(0, 40);   // ponytail: public endpoint, length cap is the only abuse guard
    const lang = { ko: 'kr', zh: 'zh', en: 'en' }[u.searchParams.get('lang')] || 'en';   // MeloTTS codes
    if (!text) return new Response('text required', { status: 400 });
    const hit = await caches.default.match(req);
    if (hit) return hit;
    let r, err;
    try { r = await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang }); } catch (e) { err = e; }
    if (!r?.audio && !(r instanceof ReadableStream) && !(r instanceof ArrayBuffer)) {
      const t = roman(text).replace(/^./, c => c.toUpperCase());
      if (!/^[\x20-\x7e]+$/.test(t)) return new Response('AI error: ' + (err?.message || 'unexpected result'), { status: 502 });
      try { r = await env.AI.run('@cf/deepgram/aura-1', { text: t }); } catch (e) { return new Response('AI error: ' + e.message, { status: 502 }); }
    }
    const body = r.audio ? Uint8Array.from(atob(r.audio), c => c.charCodeAt(0)) : r;
    const res = new Response(body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000' } });
    ctx.waitUntil(caches.default.put(req, res.clone()));
    return res;
  }
};
