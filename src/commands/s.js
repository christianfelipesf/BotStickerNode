function parsePackAuthor(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const clean = (s) => String(s || '').trim().replace(/[\n\r]/g, ' ').slice(0, 30);
    let sep = null;
    if (raw.includes('/')) sep = '/';
    else if (raw.includes('|')) sep = '|';
    if (!sep) return null; // exige "/" ou "|" igual ao !rename
    const parts = raw.split(sep);
    const pack = clean(parts[0]);
    const author = clean(parts.slice(1).join(sep));
    if (!pack && !author) return null;
    return { pack: pack || null, author: author || null };
}

module.exports = {
    name: 's',
    aliases: ['sticker', 'f', 'figurinha'],
    category: 'mídia',
    description: 'Cria um sticker a partir de imagem ou vídeo (use !s pack/autor ou !s pack | autor)',
    async execute(sock, m, { from, config, mediaHandler, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const parsed = parsePackAuthor(fullArgsText);
        const opts = {};
        if (parsed) {
            if (parsed.pack) opts.pack = parsed.pack;
            if (parsed.author) opts.author = parsed.author;
        }
        if (opts.pack || opts.author) {
            return await mediaHandler.handleMediaCommand(sock, from, m, 'sticker', config, lastBotResponse, GLOBAL_COOLDOWN, opts);
        }
        return await mediaHandler.handleMediaCommand(sock, from, m, 'sticker', config, lastBotResponse, GLOBAL_COOLDOWN);
    }
};
