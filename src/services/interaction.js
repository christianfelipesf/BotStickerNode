const axios = require('axios');

const ENDPOINTS = {
    beijar: [
        'https://api.waifu.pics/sfw/kiss',
        'https://nekos.life/api/v2/img/kiss'
    ],
    abraco: [
        'https://api.waifu.pics/sfw/hug',
        'https://nekos.life/api/v2/img/hug'
    ],
    cafune: [
        'https://api.waifu.pics/sfw/pat',
        'https://nekos.life/api/v2/img/pat'
    ],
    tapa: [
        'https://api.waifu.pics/sfw/slap',
        'https://nekos.life/api/v2/img/slap'
    ],
    soco: [
        'https://api.waifu.pics/sfw/punch',
        'https://api.waifu.im/search?included_tags=punch'
    ],
    morder: [
        'https://api.waifu.pics/sfw/bite',
        'https://api.waifu.im/search?included_tags=bite'
    ],
    lamber: [
        'https://api.waifu.pics/sfw/lick',
        'https://api.waifu.im/search?included_tags=lick'
    ],
    chute: [
        'https://api.waifu.pics/sfw/kick',
        'https://api.waifu.im/search?included_tags=kick'
    ],
    matar: [
        'https://api.waifu.pics/sfw/kill',
        'https://api.waifu.im/search?included_tags=kill'
    ],
    cutucar: [
        'https://api.waifu.pics/sfw/poke',
        'https://nekos.life/api/v2/img/poke'
    ],
    cuddle: [
        'https://api.waifu.pics/sfw/cuddle',
        'https://api.waifu.im/search?included_tags=cuddle'
    ],
    chorar: [
        'https://api.waifu.pics/sfw/cry',
        'https://api.waifu.im/search?included_tags=cry'
    ],
    highfive: [
        'https://api.waifu.pics/sfw/highfive',
        'https://api.waifu.im/search?included_tags=highfive'
    ]
};

const TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function extractUrl(data) {
    if (!data) return null;
    if (typeof data === 'string') return data;
    if (data.url) return data.url;
    if (data.image) return data.image;
    if (data.link) return data.link;
    // waifu.im retorna { images: [{ url, image_id }] }
    if (Array.isArray(data.images) && data.images[0]?.url) return data.images[0].url;
    if (data.images && data.images[0]?.url) return data.images[0].url;
    return null;
}

async function fetchImageBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: TIMEOUT_MS,
        maxContentLength: MAX_IMAGE_BYTES,
        headers: { 'User-Agent': 'BotStickerNode/1.0' }
    });
    const buf = Buffer.from(res.data);
    if (!buf || buf.length < 256) throw new Error('Imagem vazia');
    if (buf.length > MAX_IMAGE_BYTES) throw new Error('Imagem muito grande');
    const ct = (res.headers['content-type'] || '').toLowerCase();
    if (ct && !ct.startsWith('image/')) {
        // alguns endpoints retornam image mesmo sem content-type correto
        if (buf.slice(0, 2).toString('hex') !== 'ffd8' && buf.slice(0, 4).toString() !== '8950' && buf.slice(1, 4).toString() !== 'PNG' && buf.slice(0, 4).toString() !== 'RIFF') {
            // não é imagem conhecida, mas tenta mesmo assim
        }
    }
    return buf;
}

async function fetchInteractionImage(tipo) {
    const urls = ENDPOINTS[tipo] || [];
    let lastErr = null;
    for (const api of urls) {
        try {
            const { data } = await axios.get(api, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'BotStickerNode/1.0' } });
            const imageUrl = extractUrl(data);
            if (!imageUrl) throw new Error('API sem url');
            const buf = await fetchImageBuffer(imageUrl);
            return buf;
        } catch (e) {
            lastErr = e;
            console.warn(`⚠️ [interaction:${tipo}] falhou ${api}: ${e.message}`);
        }
    }
    throw lastErr || new Error('Nenhuma API disponível para ' + tipo);
}

module.exports = { ENDPOINTS, fetchInteractionImage, fetchImageBuffer };
