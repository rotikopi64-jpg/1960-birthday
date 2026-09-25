// sing.js — makes short TTS syllable clips sing: TD-PSOLA pitch + duration control, light vibrato.
// Shared by index.html (window.Sing) and test/sing.test.js (Node).
(function (root) {
  const midiHz = m => 440 * 2 ** ((m - 69) / 12);

  // Pitch-track a mono clip and find its layout: [start..a] onset, [a..b] voiced core, [b..end] tail.
  function analyze(x, sr) {
    let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
    x = Float32Array.from(x, v => v * (peak ? 0.9 / peak : 1));
    const dec = Math.max(1, Math.floor(sr / 12000)), sd = sr / dec;          // track pitch at ~12 kHz
    const lagMin = Math.floor(sd / 600), lagMax = Math.ceil(sd / 70);
    const N = Math.round(0.03 * sd), H = Math.round(0.005 * sd), n = Math.floor(x.length / dec);
    const y = new Float32Array(n + N + lagMax + 2);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < dec; k++) s += x[i * dec + k]; y[i] = s / dec; }
    const t = [], f0 = [], rms = [], r = new Float32Array(lagMax + 2);
    for (let s = 0; s < n; s += H) {
      let e = 0; for (let i = 0; i < N; i++) e += y[s + i] ** 2;
      const rm = Math.sqrt(e / N); let f = 0;
      if (rm > 0.01) {
        let best = 0;
        for (let lag = lagMin; lag <= lagMax; lag++) {
          let c = 0, e2 = 0;
          for (let i = 0; i < N; i++) { c += y[s + i] * y[s + i + lag]; e2 += y[s + i + lag] ** 2; }
          r[lag] = c / Math.sqrt(e * e2 + 1e-12); if (r[lag] > best) best = r[lag];
        }
        if (best > 0.5) for (let lag = lagMin + 1; lag < lagMax; lag++)          // first strong peak = fundamental (avoids octave-down errors)
          if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
            const d = r[lag - 1] - 2 * r[lag] + r[lag + 1];
            f = sd / (lag + (d ? 0.5 * (r[lag - 1] - r[lag + 1]) / d : 0)); break;
          }
      }
      t.push((s + N / 2) / sd); f0.push(f); rms.push(rm);
    }
    const sm = f0.map((v, i) => [f0[i - 1] ?? v, v, f0[i + 1] ?? v].sort((p, q) => p - q)[1]);   // median-3
    const on = rms.map(v => v > 0.02);
    let s0 = on.indexOf(true), s1 = on.lastIndexOf(true);
    if (s0 < 0) { s0 = 0; s1 = t.length - 1; }
    let a = sm.findIndex((v, i) => i >= s0 && v > 0), b = sm.findLastIndex((v, i) => i <= s1 && v > 0);
    if (a < 0 || b < a) { a = s0; b = s1; }
    const f0At = tt => {
      let i = Math.max(0, Math.min(sm.length - 1, Math.round((tt * sd - N / 2) / H)));
      for (let d = 0; d <= 3; d++) { if (sm[i + d] > 0) return sm[i + d]; if (sm[i - d] > 0) return sm[i - d]; }
      return 0;
    };
    // pitch marks: walk each voiced run peak to peak, one period apart, so grains keep a consistent phase
    const marks = [], mT = [];
    for (let i = 0; i < sm.length; i++) {
      if (!(sm[i] > 0) || (i > 0 && sm[i - 1] > 0)) continue;                 // start of a voiced run
      let j = i; while (j + 1 < sm.length && sm[j + 1] > 0) j++;
      const lo = Math.round(t[i] * sr), hi = Math.min(x.length - 1, Math.round(t[j] * sr));
      let T = Math.round(sr / sm[i]), c = lo, best = -Infinity;
      for (let q = lo; q < Math.min(hi, lo + T); q++) if (x[q] > best) { best = x[q]; c = q; }
      while (c <= hi) {
        marks.push(c); mT.push(T);
        T = Math.round(sr / f0At(c / sr)); let nx = c + T; best = -Infinity;
        for (let q = Math.max(c + 1, nx - (T >> 2)); q <= Math.min(x.length - 1, nx + (T >> 2)); q++) if (x[q] > best) { best = x[q]; nx = q; }
        c = nx;
      }
    }
    return { x, sr, start: Math.max(0, t[s0] - 0.015), end: Math.min(x.length / sr, t[s1] + 0.015), a: t[a], b: t[b], f0At, f0: sm, t, marks, mT };
  }

  // Sing one syllable across segs [{dur (s), midi}] (several = melisma). Returns {y, lead}: play y at (beat - lead)
  // so the vowel lands on the beat and the consonant anticipates it, like a real singer.
  function render(an, segs) {
    const { x, sr } = an, D = segs.reduce((s, g) => s + g.dur, 0);
    const onset = an.a - an.start, core = Math.max(an.b - an.a, 0.02), tail = Math.max(an.end - an.b, 0);
    let k = (D - tail) / core, ko = 1, kt = 1;
    if (k < 0.6) k = ko = kt = D / (onset + core + tail);                 // note shorter than the clip: squeeze everything
    const lead = onset * ko, len = Math.round((lead + D) * sr);
    const inv = tau => tau < 0 ? an.a + tau / ko : tau < core * k ? an.a + tau / k : an.b + Math.min(tau - core * k, tail * kt) / kt;
    const pitch = tau => {
      let s = 0;
      for (const g of segs) {
        if (tau < s + g.dur || g === segs[segs.length - 1]) {
          const rel = Math.max(0, tau - s);
          const vib = Math.min(1, Math.max(0, (rel - 0.25) / 0.25)) * 0.35 * Math.sin(2 * Math.PI * 5.5 * rel);   // vibrato after 0.25 s
          const scoop = -(1 - Math.min(1, rel / 0.07));                                                  // slide up into the note
          return midiHz(g.midi + vib + scoop);
        }
        s += g.dur;
      }
    };
    const y = new Float32Array(len), w = new Float32Array(len), { marks, mT } = an;
    let mi = 0;
    for (let tau = -lead; tau < D;) {
      const ta = inv(tau), n0 = Math.round((tau + lead) * sr);
      let c = Math.round(ta * sr), voiced = an.f0At(ta) > 0 && marks.length > 0, half, hop;
      if (voiced) {                                                          // nearest pitch mark (ta is monotonic, so the pointer only moves forward)
        while (mi + 1 < marks.length && Math.abs(marks[mi + 1] - c) <= Math.abs(marks[mi] - c)) mi++;
        while (mi > 0 && Math.abs(marks[mi - 1] - c) < Math.abs(marks[mi] - c)) mi--;
        c = marks[mi]; half = mT[mi]; hop = sr / pitch(tau);
      } else { half = Math.round(0.005 * sr); hop = half / 2; }
      c = Math.max(half, Math.min(x.length - half - 1, c));
      for (let i = -half; i < half; i++) {
        const j = n0 + i; if (j < 0 || j >= len) continue;
        const wv = 0.5 - 0.5 * Math.cos(Math.PI * (i + half) / half);
        y[j] += x[c + i] * wv; w[j] += wv;
      }
      tau += hop / sr;
    }
    for (let i = 0; i < len; i++) y[i] = w[i] > 0.05 ? y[i] / w[i] : 0;
    const fo = Math.round(0.025 * sr); for (let i = 0; i < fo; i++) y[len - 1 - i] *= i / fo;
    const fi = Math.round(0.005 * sr); for (let i = 0; i < fi; i++) y[i] *= i / fi;
    return { y, lead };
  }

  // Happy Birthday, C major 3/4, 24 beats per verse (6 per lyric line). [clip key, [[midi, beats], ...]] — several notes = melisma.
  // '*' is the birthday person's name. Clip keys are the exact TTS text of each syllable.
  const SONG = {
    en: [['hap',[[67,.75]]],['pee',[[67,.25]]],['birth',[[69,1]]],['day',[[67,1]]],['too',[[72,1]]],['you',[[71,2]]],
         ['hap',[[67,.75]]],['pee',[[67,.25]]],['birth',[[69,1]]],['day',[[67,1]]],['too',[[74,1]]],['you',[[72,2]]],
         ['hap',[[67,.75]]],['pee',[[67,.25]]],['birth',[[79,1]]],['day',[[76,1]]],['dear',[[72,1]]],['*',[[71,1],[69,1]]],
         ['hap',[[77,.75]]],['pee',[[77,.25]]],['birth',[[76,1]]],['day',[[72,1]]],['too',[[74,1]]],['you',[[72,2]]]],
    zh: [['祝',[[67,.75]]],['你',[[67,.25]]],['生',[[69,1]]],['日',[[67,1]]],['快',[[72,1]]],['乐',[[71,2]]],
         ['祝',[[67,.75]]],['你',[[67,.25]]],['生',[[69,1]]],['日',[[67,1]]],['快',[[74,1]]],['乐',[[72,2]]],
         ['祝',[[67,.75]]],['你',[[67,.25]]],['生',[[79,1]]],['日',[[76,1]]],['快',[[72,1]]],['乐',[[71,1],[69,1]]],
         ['祝',[[77,.75]]],['你',[[77,.25]]],['生',[[76,1]]],['日',[[72,1]]],['快',[[74,1]]],['乐',[[72,2]]]],
    ko: [['생',[[67,.75]]],['일',[[67,.25]]],['추',[[69,1]]],['카',[[67,1]]],['함',[[72,1]]],['니',[[71,1]]],['다',[[71,1]]],   // 축하합니다 as sung: 추카함니다
         ['생',[[67,.75]]],['일',[[67,.25]]],['추',[[69,1]]],['카',[[67,1]]],['함',[[74,1]]],['니',[[72,1]]],['다',[[72,1]]],
         ['사',[[67,.75]]],['랑',[[67,.25]]],['하',[[79,1]]],['는',[[76,1]]],['*',[[72,1],[71,1],[69,1]]],
         ['생',[[77,.75]]],['일',[[77,.25]]],['추',[[76,1]]],['카',[[72,1]]],['함',[[74,1]]],['니',[[72,1]]],['다',[[72,1]]]],
  };

  // Sing one verse (24 beats). clipFor(key) -> analyzed clip or null (null = silent slot, e.g. no name yet).
  function renderVerse(entries, clipFor, beatSec, transpose, sr) {
    const out = new Float32Array(Math.round(24 * beatSec * sr) + Math.round(0.1 * sr));
    let beat = 0;
    for (const [key, notes] of entries) {
      const an = clipFor(key);
      if (an) {
        const { y, lead } = render(an, notes.map(([m, b]) => ({ midi: m + transpose, dur: b * beatSec })));
        const at = Math.round((beat * beatSec - lead) * sr);
        for (let i = 0; i < y.length; i++) if (at + i >= 0 && at + i < out.length) out[at + i] += y[i];
      }
      beat += notes.reduce((s, [, b]) => s + b, 0);
    }
    let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.8) for (let i = 0; i < out.length; i++) out[i] *= 0.8 / peak;
    return out;
  }

  root.Sing = { analyze, render, renderVerse, midiHz, SONG };
})(typeof module !== 'undefined' ? module.exports : window);
