const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const axios = require('axios');
const { getMaxDurationSeconds, fetchYouTubeDuration, buildDurationErrorMessage } = require('../services/durationLimit');
const { enqueueDownload, enqueueSend } = require('../services/queue');
const { sendMessageSafe } = require('../database/utils');
const {
    PLATFORM_CONFIG, YTDLP_PLATFORMS, BTCH_PLATFORMS, BTCH_BASE_URL,
    correctFileExtension, sniffExtFromFile, extractUrl, getPlatform,
    normalizeLang, parseLangFromText, getFormatSelector, callBtchApi, downloadFromUrl,
    getMaxDownloadBytes, searchYouTube
} = require('../services/downloaderCore');
const { runYtDlp: _coreRunYtDlp, buildYtDlpArgs: _coreBuildYtDlpArgs } = require('../services/downloaderCore');

const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const cookiesPath = path.join(process.cwd(), 'cookies.txt');
function hasCookies() { return fs.existsSync(cookiesPath); }
function buildYtDlpArgs(url, platform, hd, outTemplate, lang = null) {
    return _coreBuildYtDlpArgs(url, platform, hd, outTemplate, lang, { cookiesPath: hasCookies() ? cookiesPath : null });
}
function runYtDlp(args, timeoutMs = 300000) { return _coreRunYtDlp(args, timeoutMs); }

async function downloadBtch(platform, url, id, hd) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg || !cfg.api) return [];
    console.log(`[BTCH] ${platform} downloading via btch-downloader...`);
    try {
        const data = await callBtchApi(cfg.api, url);
        const results = [];
        const dl = (mediaUrl, idx = 0) => {
            if (!mediaUrl) return null;
            try {
                const ext = path.extname(new URL(mediaUrl).pathname) || '.mp4';
                const dest = path.join(tempDir, `dl_${id}_btch_${idx}${ext}`);
                return { url: mediaUrl, dest };
            } catch (_) { return null; }
        };

        if (platform === 'instagram') {
            if (!Array.isArray(data)) throw new Error('resposta inválida');
            for (let i = 0; i < data.length; i++) {
                const item = dl(data[i].url, i);
                if (!item) continue;
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            }
        } else if (platform === 'tiktok') {
            const videos = hd ? (data?.video || []) : (data?.video?.length ? [data.video[data.video.length - 1]] : []);
            if (!videos.length && data?.video?.length) throw new Error('sem mídia');
            const arr = data?.video || [];
            for (let i = 0; i < arr.length; i++) {
                const item = dl(arr[i], i);
                if (!item) continue;
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            }
        } else if (platform === 'facebook') {
            const fbUrl = hd ? (data?.HD || data?.Normal_video) : (data?.Normal_video || data?.HD);
            if (!fbUrl) throw new Error('sem mídia');
            const item = dl(fbUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'twitter') {
            if (!data?.url) throw new Error('sem mídia');
            const item = dl(data.url, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'youtube') {
            const vidUrl = hd ? (data?.mp4 || data?.mp3) : (data?.mp3 || data?.mp4);
            if (!vidUrl) throw new Error('sem mídia');
            const item = dl(vidUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'capcut') {
            if (!data?.originalVideoUrl) throw new Error('sem mídia');
            const item = dl(data.originalVideoUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'pinterest') {
            if (data?.video_url) {
                const item = dl(data.video_url, 0);
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            } else if (data?.image) {
                const item = dl(data.image, 0);
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            } else if (data?.result?.length) {
                for (let i = 0; i < Math.min(data.result.length, 5); i++) {
                    const pin = data.result[i];
                    const imgUrl = pin?.video_url || pin?.image_url || pin?.images?.original;
                    if (!imgUrl) continue;
                    const item = dl(imgUrl, i);
                    item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                    results.push(item.dest);
                }
            } else throw new Error('sem mídia');
        } else if (platform === 'gdrive') {
            const dlUrl = data?.result?.downloadUrl || data?.downloadUrl;
            if (!dlUrl) throw new Error('sem mídia');
            const item = dl(dlUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'mediafire') {
            const mfUrl = data?.result?.url || data?.url;
            if (!mfUrl) throw new Error('sem mídia');
            const item = dl(mfUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'douyin') {
            const links = data?.result?.links || data?.links;
            if (!links?.length) throw new Error('sem mídia');
            const item = dl(links[0].url, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'snackvideo') {
            const svUrl = data?.result?.videoUrl || data?.videoUrl || data?.url;
            if (!svUrl) throw new Error('sem mídia');
            const item = dl(svUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'xiaohongshu') {
            const downloads = data?.result?.downloads;
            const images = data?.result?.images;
            if (downloads?.length) {
                for (let i = 0; i < downloads.length; i++) {
                    const item = dl(downloads[i].url, i);
                    if (!item) continue;
                    item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                    results.push(item.dest);
                }
            } else if (images?.length) {
                for (let i = 0; i < images.length; i++) {
                    const item = dl(images[i], i);
                    item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                    results.push(item.dest);
                }
            } else throw new Error('sem mídia');
        } else if (platform === 'cocofun') {
            const cfUrl = data?.result?.no_watermark || data?.result?.watermark || data?.no_watermark || data?.watermark;
            if (!cfUrl) throw new Error('sem mídia');
            const item = dl(cfUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'spotify') {
            const formats = data?.result?.formats || data?.formats;
            if (!formats?.length) throw new Error('sem mídia');
            const best = formats.reduce((a, b) => (parseInt(b.quality) || 0) > (parseInt(a.quality) || 0) ? b : a);
            const item = dl(best.url, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'soundcloud') {
            const scUrl = data?.result?.downloadMp3 || data?.result?.audio || data?.downloadMp3 || data?.audio;
            if (!scUrl) throw new Error('sem mídia');
            const item = dl(scUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'threads') {
            const thUrl = data?.result?.video || data?.result?.image || data?.video || data?.image;
            if (!thUrl) throw new Error('sem mídia');
            const item = dl(thUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'kuaishou') {
            const ksUrl = data?.result?.videoUrl || data?.videoUrl;
            if (!ksUrl) throw new Error('sem mídia');
            const item = dl(ksUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        }

        if (!results.length) throw new Error('nenhuma mídia baixada');
        return results;
    } catch (e) {
        console.log(`[BTCH] ${platform} falhou: ${e.message}`);
        return [];
    }
}

function findDownloadedFiles(id) {
    const { findDownloadedFiles: coreFind } = require('../services/downloaderCore');
    return coreFind(tempDir, 'dl_', id);
}

async function sendMedia(sock, from, m, filePath, title) {
    // defesa: se arquivo foi salvo como .mp4 mas é imagem, corrige antes de enviar
    try { filePath = correctFileExtension(filePath, null); } catch (_) {}
    let ext = path.extname(filePath).toLowerCase();
    // double-check por sniff caso extensão ainda esteja errada
    const sniffed = sniffExtFromFile(filePath);
    if (sniffed && sniffed !== ext) {
        const isVideoExt = ['.mp4', '.webm', '.mkv', '.mov'].includes(ext);
        const isImageSniff = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(sniffed);
        if (isVideoExt && isImageSniff) ext = sniffed;
    }
    const mime = (() => {
        if (['.mp4', '.webm', '.mkv', '.mov'].includes(ext)) return 'video/mp4';
        if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg';
        if (['.png'].includes(ext)) return 'image/png';
        if (['.gif'].includes(ext)) return 'image/gif';
        if (['.webp'].includes(ext)) return 'image/webp';
        if (['.mp3', '.m4a', '.ogg'].includes(ext)) return 'audio/mpeg';
        return 'application/octet-stream';
    })();

    const fileName = (title ? title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) : 'media') + ext;

    // Envio serializado pela fila global + retry/backoff em rate-limit (429)
    const send = (payload) => enqueueSend(() =>
        sendMessageSafe(sock, from, payload, { sendOptions: { quoted: m }, maxRetries: 2, baseDelayMs: 5000 })
    );

    if (mime.startsWith('video/')) {
        return await send({ video: { url: filePath }, mimetype: 'video/mp4', fileName });
    } else if (mime.startsWith('image/')) {
        return await send({ image: { url: filePath }, fileName });
    } else if (mime.startsWith('audio/')) {
        return await send({ audio: { url: filePath }, mimetype: 'audio/mp4', fileName });
    } else {
        return await send({ document: { url: filePath }, fileName, mimetype: mime });
    }
}

module.exports = {
    name: 'download',
    aliases: ['dl', 'baixar', 'media', 'social', 'tiktok', 'ttk', 'fb', 'facebook', 'insta', 'instagram', 'reel', 'shorts', 'youtube', 'yt', 'twitter', 'x', 'playv', 'playvideo', 'dhd', 'downloadhd'],
    category: 'mídia',
    description: 'Baixa mídia de redes sociais ou busca YouTube por texto (limite configurável de duração e MB)',
    async execute(sock, m, { from, fullArgsText, commandName, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus } = utils;
        const hd = commandName === 'downloadhd' || commandName === 'dhd';
        let url = extractUrl(fullArgsText);
        let searchResult = null;
        let isSearch = false;

        if (!url) {
            const queryRaw = String(fullArgsText || '').trim();
            if (queryRaw && queryRaw.length >= 2 && !/^https?:\/\//i.test(queryRaw)) {
                let currentSearch = await react(sock, m, '🔎', lastBotResponse, GLOBAL_COOLDOWN);
                try {
                    // separa eventual token de idioma no fim da busca (ex: "musica original" → lang null)
                    let searchQuery = queryRaw;
                    try {
                        const { parseLangFromQuery } = require('../services/downloaderCore');
                        const pq = parseLangFromQuery(queryRaw);
                        if (pq.query !== queryRaw) searchQuery = pq.query;
                    } catch (_) {}
                    const found = await searchYouTube(searchQuery);
                    if (found && found.url) {
                        url = found.url;
                        searchResult = found;
                        isSearch = true;
                    } else {
                        await react(sock, m, '❌', currentSearch, GLOBAL_COOLDOWN);
                        return await sock.sendMessage(from, {
                            text: `❌ *Nenhum resultado para:* "${queryRaw.slice(0,80)}"\n\n💡 Tente reformular a busca ou envie um link direto.\n📌 *Uso:* ${hd ? '!dhd' : '!download'} <link ou texto>`
                        }, { quoted: m });
                    }
                } catch (e) {
                    await react(sock, m, '❌', currentSearch, GLOBAL_COOLDOWN);
                    return await sock.sendMessage(from, { text: `❌ Falha na busca: ${e.message}` }, { quoted: m });
                }
            } else {
                await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
                return await sock.sendMessage(from, {
                    text: `❌ *Envie um link ou texto para buscar!*\n\n📌 *Uso:* ${hd ? '!dhd' : '!download'} <link ou nome>\nEx: \`!dl never gonna give you up\` ou \`!dl https://youtu.be/...\`\n\n✅ *Plataformas suportadas:*\n• Instagram, TikTok, YouTube (busca por texto), Facebook, Twitter/X, CapCut, Pinterest, Google Drive, MediaFire, Douyin, Xiaohongshu, Spotify, SoundCloud, Threads, Kuaishou, SnackVideo, Cocofun, Reddit`
                }, { quoted: m });
            }
        }

        const platform = getPlatform(url);
        if (!platform) {
            await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, {
                text: `❌ *Site não suportado!*\n\n🔗 ${url}`
            }, { quoted: m });
        }

        // lang: youtube default pt (dublagem), override via trailing token (original/en/pt/etc.)
        let youtubeLang;
        if (platform === 'youtube') {
            if (isSearch) {
                // para busca, tenta parsear lang do fim da query original
                const qLangParsed = (() => {
                    try { const { parseLangFromQuery } = require('../services/downloaderCore'); return parseLangFromQuery(String(fullArgsText||'').trim()); } catch (_) { return null; }
                })();
                if (qLangParsed && qLangParsed.lang !== undefined) youtubeLang = qLangParsed.lang;
                else youtubeLang = 'pt';
            } else {
                const parsed = parseLangFromText(fullArgsText, url);
                if (parsed !== null) youtubeLang = parsed;
                else {
                    const afterUrl = fullArgsText.slice(fullArgsText.indexOf(url) + url.length).trim().toLowerCase();
                    if (afterUrl === 'original' || afterUrl === 'orig') youtubeLang = null;
                    else youtubeLang = 'pt';
                }
            }
        } else {
            youtubeLang = null;
        }
        const effectiveLang = platform === 'youtube' ? youtubeLang : null;

        let currentBotResponse = await react(sock, m, '🔎', lastBotResponse, GLOBAL_COOLDOWN);

        if (platform === 'youtube') {
            const maxSeconds = getMaxDurationSeconds();
            let ytSeconds = searchResult?.seconds ?? null;
            let ytTitle = searchResult?.title ?? null;
            if (!Number.isFinite(ytSeconds) || ytSeconds <= 0) {
                const info = await fetchYouTubeDuration(url, hasCookies() ? cookiesPath : null);
                ytSeconds = info.seconds;
                ytTitle = info.title || ytTitle;
                if (Number.isFinite(ytSeconds) && ytSeconds > maxSeconds) {
                    await sock.sendMessage(from, {
                        text: buildDurationErrorMessage({ url, seconds: ytSeconds, title: ytTitle, platform, maxSeconds })
                    }, { quoted: m });
                    return await react(sock, m, '⏱️', currentBotResponse, GLOBAL_COOLDOWN);
                }
            } else if (ytSeconds > maxSeconds) {
                await sock.sendMessage(from, {
                    text: buildDurationErrorMessage({ url, seconds: ytSeconds, title: ytTitle, platform, maxSeconds })
                }, { quoted: m });
                return await react(sock, m, '⏱️', currentBotResponse, GLOBAL_COOLDOWN);
            }
        }

        const id = crypto.randomBytes(4).toString('hex');

        try {
            currentBotResponse = await react(sock, m, '⬇️', currentBotResponse, GLOBAL_COOLDOWN);

            let allFiles = [];
            const preferYtDlp = platform === 'youtube' && !!effectiveLang;

            if (BTCH_PLATFORMS.has(platform) && !preferYtDlp) {
                currentBotResponse = await react(sock, m, '📥', currentBotResponse, GLOBAL_COOLDOWN);
                allFiles = await enqueueDownload(() => downloadBtch(platform, url, id, hd));
            }

            if (allFiles.length === 0 && YTDLP_PLATFORMS.has(platform)) {
                console.log(`[YT-DLP] ${platform} via yt-dlp${effectiveLang ? ` lang=${effectiveLang}` : ''}...`);
                const template = path.join(tempDir, `dl_${id}_%(playlist_index|)s%(playlist_index&_|)s%(id)s.%(ext)s`);

                let title = '';
                try {
                    const titleArgs = [
                        '--no-warnings', '--ignore-errors', '--no-abort-on-error',
                        '--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com',
                        '--print', '%(title)s',
                        ...(hasCookies() ? ['--cookies', cookiesPath] : []),
                    ];
                    if (platform === 'twitter') titleArgs.push('--yes-playlist');
                    else titleArgs.push('--no-playlist');
                    titleArgs.push(url);
                    const dump = spawn('yt-dlp', titleArgs, { shell: false, windowsHide: true });
                    const chunks = [];
                    dump.stdout.on('data', d => chunks.push(d));
                    const tmo = setTimeout(() => { try { dump.kill('SIGKILL'); } catch (_) {} }, 15000);
                    await new Promise((resolve) => { dump.on('error', () => { clearTimeout(tmo); resolve(); }); dump.on('close', () => { clearTimeout(tmo); resolve(); }); });
                    title = Buffer.concat(chunks).toString('utf8').trim().split('\n')[0];
                } catch (_) { title = '' }

                let result = await enqueueDownload(async () => {
                    let files = [];
                    let r = await runYtDlp(buildYtDlpArgs(url, platform, hd, template, effectiveLang));
                    files = findDownloadedFiles(id);

                    if (files.length === 0 && platform === 'instagram' && !hasCookies()) {
                        for (const browser of ['chrome', 'brave', 'firefox', 'edge']) {
                            console.log(`[RETRY] Instagram --cookies-from-browser ${browser}...`);
                            const retryArgs = buildYtDlpArgs(url, platform, hd, template, effectiveLang);
                            const idx = retryArgs.indexOf('--add-header');
                            if (idx !== -1) retryArgs.splice(idx, 0, '--cookies-from-browser', browser);
                            else retryArgs.splice(retryArgs.length - 1, 0, '--cookies-from-browser', browser);
                            r = await runYtDlp(retryArgs, 60000);
                            files = findDownloadedFiles(id);
                            if (files.length > 0) break;
                        }
                    }

                    if (files.length === 0 && platform === 'instagram') {
                        console.log(`[RETRY] Instagram --yes-playlist...`);
                        const retryArgs = buildYtDlpArgs(url, platform, hd, template, effectiveLang);
                        const idx2 = retryArgs.indexOf('--add-header');
                        if (idx2 !== -1) retryArgs.splice(idx2, 0, '--yes-playlist', '--extractor-args', 'instagram:allow_direct_url=True');
                        else retryArgs.splice(retryArgs.length - 1, 0, '--yes-playlist');
                        r = await runYtDlp(retryArgs);
                        files = findDownloadedFiles(id);
                    }
                    return files;
                });
                allFiles = allFiles.length ? allFiles : result;
                // fallback btch para youtube com dublagem quando yt-dlp falhou
                if (allFiles.length === 0 && preferYtDlp && BTCH_PLATFORMS.has(platform)) {
                    console.log(`[YT-DLP] ${platform} yt-dlp falhou, tentando btch fallback...`);
                    allFiles = await enqueueDownload(() => downloadBtch(platform, url, id, hd));
                }
            }

            if (allFiles.length === 0 && platform === 'instagram') {
                const result = { stderr: '' };
                throw new Error(`Instagram bloqueou o acesso. Use cookies.txt na raiz do bot (extensão Get cookies.txt) ou tente no terminal: yt-dlp --cookies-from-browser chrome "${url}"`);
            }

            if (allFiles.length === 0) {
                throw new Error('Não foi possível baixar a mídia. O link pode ser inválido ou estar protegido.');
            }

            let totalSize = 0;
            const maxBytes = getMaxDownloadBytes();
            const maxMB = Math.round(maxBytes / 1024 / 1024);
            try { totalSize = allFiles.reduce((acc, f) => { try { return acc + fs.statSync(f).size; } catch (_) { return acc; } }, 0); } catch (_) { totalSize = 0; }
            if (totalSize > maxBytes) {
                for (const f of allFiles) { try { fs.unlinkSync(f); } catch (_) {} }
                throw new Error(`Limite de ${maxMB}MB excedido (${(totalSize / 1048576).toFixed(2)}MB). Use \`!set maxDownloadSizeMB <valor>\` ou tente qualidade menor.`);
            }

            currentBotResponse = await react(sock, m, '📤', currentBotResponse, GLOBAL_COOLDOWN);

            for (let i = 0; i < allFiles.length; i++) {
                const filePath = allFiles[i];
                const ext = path.extname(filePath).slice(1).toUpperCase();
                let caption;
                if (isSearch && searchResult?.title) caption = `🎬 *${searchResult.title.slice(0,60)}* [${ext}]`;
                else caption = allFiles.length > 1 ? `📎 *Mídia* (${i + 1}/${allFiles.length}) [${ext}]` : 'Mídia';
                await sendMedia(sock, from, m, filePath, caption);
                try { fs.unlinkSync(filePath); } catch (_) {}
                if (allFiles.length > 1) await new Promise(r => setTimeout(r, 800));
            }

            return await reactStatus(sock, m, from, true, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);

        } catch (e) {
            console.error(`\x1b[31m[DOWNLOAD ERROR]\x1b[0m ${e.message}`);
            if (e.stack) console.error(`\x1b[2m${e.stack.split('\n').slice(1, 3).join('\n')}\x1b[0m`);

            const partial = findDownloadedFiles(id);
            for (const f of partial) { try { fs.unlinkSync(f); } catch (_) {} }

            currentBotResponse = await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, {
                text: `❌ *Falha no Download!*\n\n💬 *Motivo:* ${e.message}\n\n💡 Tente novamente ou use um link diferente.`
            }, { quoted: m });
            return currentBotResponse;
        }
    }
};
