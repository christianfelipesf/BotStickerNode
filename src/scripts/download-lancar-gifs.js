const axios = require('axios');
const fs = require('fs');
const path = require('path');

const OUT_BASE = path.join(__dirname, '..', 'media', 'interacoes');
const TARGET = 6;

const JOBS = [
  { tipo: 'lancar_fogo',  queries: ['fireball-attack', 'anime-fire-attack', 'shooting-fire', 'fire-blast'] },
  { tipo: 'lancar_agua',  queries: ['water-attack-anime', 'water-blast', 'waterball', 'anime-water-attack'] },
  { tipo: 'lancar_pedra', queries: ['rock-throw', 'earth-attack-anime', 'stone-throw', 'rock-attack-pokemon'] },
  { tipo: 'lancar_laser', queries: ['laser-beam-attack', 'kamehameha', 'energy-beam-attack', 'anime-laser'] },
  { tipo: 'lancar_raio',  queries: ['lightning-attack-anime', 'thunder-bolt-attack', 'lightning-strike-anime', 'raikiri'] },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function searchTenorGifs(query, limit = 30) {
  const url = `https://tenor.com/search/${encodeURIComponent(query)}-gifs`;
  const res = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
  const found = [...res.data.matchAll(/https:\/\/media\.tenor\.com\/[^"' ]+\.gif/g)].map(x => x[0]);
  return [...new Set(found)].slice(0, limit);
}

async function downloadGif(gifUrl) {
  const res = await axios.get(gifUrl, {
    responseType: 'arraybuffer', timeout: 25000,
    maxContentLength: 8 * 1024 * 1024,
    headers: { 'User-Agent': UA, Referer: 'https://tenor.com/' }
  });
  const buf = Buffer.from(res.data);
  if (buf.length < 1024) throw new Error('muito pequeno');
  const head = buf.slice(0, 6).toString('ascii');
  if (head !== 'GIF89a' && head !== 'GIF87a') throw new Error('nao-gif:' + head);
  if (buf.length > 4 * 1024 * 1024) throw new Error('grande demais ' + Math.round(buf.length / 1024) + 'KB');
  return buf;
}

function countGifs(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => /\.gif$/i.test(f)).length;
}

(async () => {
  let totalOk = 0, totalFail = 0;
  for (const { tipo, queries } of JOBS) {
    const dir = path.join(OUT_BASE, tipo);
    fs.mkdirSync(dir, { recursive: true });
    let have = countGifs(dir);
    if (have >= TARGET) { console.log(`SKIP [${tipo}] ja tem ${have}`); continue; }
    console.log(`SEARCH [${tipo}] tem ${have}/${TARGET}`);
    let candidates = [];
    for (const q of queries) {
      try {
        const urls = await searchTenorGifs(q, 30);
        console.log(`   "${q}": ${urls.length} urls`);
        candidates.push(...urls);
      } catch (e) { console.log(`   "${q}" falhou: ${e.message}`); }
      await sleep(800);
    }
    candidates = [...new Set(candidates)];
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    console.log(`   total unicos: ${candidates.length}`);
    const seenSizes = new Set(
      fs.readdirSync(dir).filter(f => /\.gif$/i.test(f))
        .map(f => { try { return fs.statSync(path.join(dir, f)).size; } catch { return -1; } })
    );
    let need = TARGET - have;
    let idx = 2;
    const existingNames = new Set(fs.readdirSync(dir));
    const short = tipo.replace('lancar_', '');
    for (const u of candidates) {
      if (need <= 0) break;
      while (existingNames.has(`${short}-${String(idx).padStart(2, '0')}.gif`)) idx++;
      try {
        const buf = await downloadGif(u);
        if (seenSizes.has(buf.length)) { console.log(`   ... duplicado (${buf.length}b)`); continue; }
        const name = `${short}-${String(idx).padStart(2, '0')}.gif`;
        fs.writeFileSync(path.join(dir, name), buf);
        existingNames.add(name);
        seenSizes.add(buf.length);
        console.log(`   OK [${tipo}] ${name} (${Math.round(buf.length / 1024)}KB)`);
        idx++; need--; totalOk++;
      } catch (e) {
        console.log(`   ... pulado: ${e.message}`);
        totalFail++;
      }
      await sleep(500);
    }
    console.log(`DONE [${tipo}] agora com ${countGifs(dir)}/${TARGET}\n`);
    await sleep(1000);
  }
  console.log(`FIM: +${totalOk} baixados, ${totalFail} pulados`);
})();
