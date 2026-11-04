// gen-audio.js — synthesizes the bundled sound assets (alarm chime + click).
// Run: node tools/gen-audio.js
// Writes MP3 (via the lamejs bundle) and WAV (pure Node) into the app's assets/sounds.
// Dev-time only; the shipped site has zero runtime dependencies.
const fs = require('fs');
const path = require('path');

// lamejs ships a browser bundle that expects a global `lamejs`.
global.window = global;
let Mp3Encoder = null;
try {
  const bundle = path.join(__dirname, 'node_modules', 'lamejs', 'lame.all.js');
  if (fs.existsSync(bundle)) {
    // eslint-disable-next-line no-eval
    (0, eval)(fs.readFileSync(bundle, 'utf8'));
    Mp3Encoder = global.lamejs && global.lamejs.Mp3Encoder;
  }
} catch (err) { Mp3Encoder = null; }

const RATE = 44100;

function tone(buf, startSec, durSec, freq, gain) {
  const start = Math.floor(startSec * RATE);
  const n = Math.floor(durSec * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.005);
    const e = attack * Math.exp(-t * 3.2);
    const s = Math.sin(2 * Math.PI * freq * t) * 0.62
            + Math.sin(2 * Math.PI * freq * 2 * t) * 0.24
            + Math.sin(2 * Math.PI * freq * 3 * t) * 0.10;
    const idx = start + i;
    if (idx < buf.length) buf[idx] += s * e * gain;
  }
}

function toInt16(buf) {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i];
    if (v > 1) v = 1;
    if (v < -1) v = -1;
    out[i] = Math.round(v * 32767);
  }
  return out;
}

function encodeMp3(samples, kbps) {
  if (!Mp3Encoder) return null;
  const enc = new Mp3Encoder(1, RATE, kbps);
  const chunk = 1152;
  const parts = [];
  for (let i = 0; i < samples.length; i += chunk) {
    const b = enc.encodeBuffer(samples.subarray(i, i + chunk));
    if (b.length) parts.push(Buffer.from(b));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

function wav(buf) {
  const data = toInt16(buf);
  const bytes = data.length * 2;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + bytes, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(bytes, 40);
  return Buffer.concat([head, Buffer.from(data.buffer, data.byteOffset, bytes)]);
}

const outDir = path.join(__dirname, '..', 'pomodoro-timer', 'assets', 'sounds');
fs.mkdirSync(outDir, { recursive: true });

// alarm: warm rising three-note chime (E5 -> A5 -> C#6)
const alarm = new Float64Array(Math.floor(1.2 * RATE));
tone(alarm, 0.00, 0.55, 659.25, 0.85);
tone(alarm, 0.17, 0.55, 880.00, 0.72);
tone(alarm, 0.34, 0.80, 1108.73, 0.62);
const alarmMp3 = encodeMp3(toInt16(alarm), 128);
if (alarmMp3) fs.writeFileSync(path.join(outDir, 'alarm.mp3'), alarmMp3);
fs.writeFileSync(path.join(outDir, 'alarm.wav'), wav(alarm));

// click: very short soft blip
const click = new Float64Array(Math.floor(0.07 * RATE));
tone(click, 0, 0.06, 1320, 0.5);
const clickMp3 = encodeMp3(toInt16(click), 96);
if (clickMp3) fs.writeFileSync(path.join(outDir, 'click.mp3'), clickMp3);
fs.writeFileSync(path.join(outDir, 'click.wav'), wav(click));

console.log('MP3 support:', !!Mp3Encoder);
console.log('wrote', fs.readdirSync(outDir).map((f) => f + ' ' + fs.statSync(path.join(outDir, f)).size + 'B').join(', '));
