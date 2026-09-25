// node test/sing.test.js [clipsDir] — renders all three verses from WAV syllable clips and checks every sung
// note lands on its target pitch. Writes verse_<lang>.wav next to the clips for listening.
const fs = require('fs'), path = require('path'), os = require('os');
const { analyze, renderVerse, midiHz, SONG } = require('../public/sing.js').Sing;
const DIR = process.argv[2] || path.join(__dirname, '../public/voice'), NAME = process.env.NAME || '민수';
const BEAT = 10 / 24, TRANSPOSE = -14, SR = 24000;

function readWav(p) {
  const b = fs.readFileSync(p); let q = 12, fmt, data;
  while (q + 8 <= b.length) {
    const id = b.toString('ascii', q, q + 4), sz = b.readUInt32LE(q + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(q + 10), sr: b.readUInt32LE(q + 12) };
    if (id === 'data') data = b.subarray(q + 8, q + 8 + sz);
    q += 8 + sz + (sz & 1);
  }
  const n = Math.floor(data.length / 2 / fmt.ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { x, sr: fmt.sr };
}
function writeWav(p, x, sr) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(p, b);
}
const median = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

let worst = 0, failures = 0;
for (const l in SONG) { const beats = SONG[l].reduce((s, [, n]) => s + n.reduce((q, [, b]) => q + b, 0), 0); if (beats !== 24) { console.log(`${l}: ${beats} beats, expected 24`); failures++; } }
for (const lang of ['en', 'zh', 'ko']) {
  const clips = {};
  const clipFor = key => {
    const file = path.join(DIR, lang, (key === '*' ? NAME : key) + '.wav');
    if (!fs.existsSync(file)) return null;
    if (!clips[key]) { const { x, sr } = readWav(file); if (sr !== SR) throw new Error(`${file}: expected ${SR} Hz`); clips[key] = analyze(x, sr); }
    return clips[key];
  };
  const y = renderVerse(SONG[lang], clipFor, BEAT, TRANSPOSE, SR);
  let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
  writeWav(path.join(os.tmpdir(), `verse_${lang}.wav`), y, SR);
  // check each single-note syllable: median f0 of the sung region vs target
  let beat = 0, bad = [];
  for (const [key, notes] of SONG[lang]) {
    const dur = notes.reduce((s, [, b]) => s + b, 0) * BEAT;
    if (notes.length === 1 && dur >= 0.4 && clipFor(key)) {
      const t0 = beat * BEAT + 0.12, t1 = beat * BEAT + dur - 0.05;
      const an = analyze(y.subarray(Math.round(t0 * SR), Math.round(t1 * SR)), SR);
      const f = an.f0.filter(v => v > 0), target = midiHz(notes[0][0] + TRANSPOSE);
      const cents = f.length ? 1200 * Math.log2(median(f) / target) : NaN;
      worst = Math.max(worst, Math.abs(cents) || 0);
      if (!(Math.abs(cents) < 50)) { bad.push(`${key}@${beat}: ${isNaN(cents) ? 'unvoiced' : cents.toFixed(0) + 'c'}`); failures++; }
    }
    beat += dur / BEAT;
  }
  console.log(`${lang}: peak ${peak.toFixed(2)} ${bad.length ? 'BAD ' + bad.join(', ') : 'all notes in tune'}`);
}
console.log(`worst pitch error ${worst.toFixed(0)} cents, ${failures} failures; verses written to ${os.tmpdir()}/verse_<lang>.wav`);
process.exit(failures ? 1 : 0);
