// node dog_clips.mjs <dir with _POLYGON_Dog_*.fbx> <out json>
// Synty's dog clips are ASCII FBX; three's FBXLoader reads them. Joint names and local frames match dog.glb.
import { readFileSync, writeFileSync } from 'node:fs';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
const [dir, out] = process.argv.slice(2);
const CLIPS = { idle: 'Locomotion_Standing', sniff: 'Action_Standing_Sniff', walk: 'Locomotion_Walking', run: 'Locomotion_Running', bark: 'Action_Standing_Bark', sit: 'Sitting', wag: 'Action_Standing_TailWag' };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clips = [];
for (const [name, f] of Object.entries(CLIPS)) {
  const buf = readFileSync(`${dir}/_POLYGON_Dog_${f}.fbx`);
  const g = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const c = g.animations[0];
  const tracks = [];
  for (const t of c.tracks) {
    const [node, prop] = t.name.split('.');
    if (prop === 'scale') continue;
    if (prop === 'position' && node !== 'spine_C0_hip_joint') continue;
    const n = t.getValueSize();
    const v = t.values;
    let constant = true;
    for (let i = n; i < v.length && constant; i++) if (Math.abs(v[i] - v[i % n]) > 1e-4) constant = false;
    // keep every 2nd key (15 fps is plenty for these clips) plus the last one
    const keep = [];
    for (let k = 0; k < t.times.length; k++) if (k % 2 === 0 || k === t.times.length - 1) keep.push(k);
    const times = constant ? [0] : keep.map((k) => r4(t.times[k]));
    const values = constant ? Array.from(v.slice(0, n), r4) : keep.flatMap((k) => Array.from(v.slice(k * n, k * n + n), r4));
    tracks.push({ name: t.name, type: prop === 'quaternion' ? 'quaternion' : 'vector', times, values });
  }
  clips.push({ name, duration: r4(c.duration), tracks });
  console.log(name, c.duration.toFixed(2), 's', tracks.length, 'tracks');
}
writeFileSync(out, JSON.stringify(clips));
console.log('wrote', out, (JSON.stringify(clips).length / 1024).toFixed(0), 'KB');
