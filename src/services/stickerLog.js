const fs = require('fs');
const path = require('path');

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}

function getFile() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return path.join(logsDir, `sticker_${y}-${m}-${day}.log`);
}

function safe(v){
    if (v==null) return 'null';
    if (typeof v==='string') return v.replace(/\n/g,'\\n').slice(0,200);
    try{ return JSON.stringify(v).slice(0,500);}catch{ return String(v).slice(0,200);}
}

function logSticker(entry){
    // entry: { ts, from, groupName, senderJid, senderName, quotedSender, mediaType, mime, detectedMime, pack, author, packSource, authorSource, explicitOpts, inputBytes, outputBytes, exifLen, success, error, tempId, durationMs }
    const ts = new Date().toISOString();
    const line = `[${ts}] !s pack="${safe(entry.pack)}" author="${safe(entry.author)}" packSource=${entry.packSource||'none'} authorSource=${entry.authorSource||'none'} explicit=${safe(entry.explicitOpts)} mediaType=${entry.mediaType} mime=${entry.mime} input=${entry.inputBytes} output=${entry.outputBytes} exifLen=${entry.exifLen||0} from=${entry.from} group=${safe(entry.groupName)} sender=${safe(entry.senderName)}(${entry.senderJid}) quoted=${safe(entry.quotedSender)} success=${entry.success} dur=${entry.durationMs||0}ms ${entry.error?'error='+safe(entry.error):''}\n`;
    try{ fs.appendFileSync(getFile(), line); }catch(_){}
    // também vai para console (terminalLog vai capturar)
    try{ console.log(`[STICKER-HISTORY] ${line.trim()}`);}catch(_){}
}

function getRecentStickerLogs(limit=50){
    try{
        const f = getFile();
        if (!fs.existsSync(f)) return [];
        const content = fs.readFileSync(f,'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        return lines.slice(-Math.max(1,Math.min(limit,200)));
    }catch{ return [];}
}

module.exports = { logSticker, getRecentStickerLogs };
