module.exports = {
    name: 'comandosinteracao',
    aliases: ['interacao', 'interacoes', 'menuinteracao', 'interaçao', 'interações'],
    category: 'interação',
    description: 'Lista comandos de interação',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName } = utils;
        let current = await react(sock, m, '💞', lastBotResponse, GLOBAL_COOLDOWN);
        const botName = getBotName(from, config);
        const p = config.prefix;
        const text = `*${botName} — Interações* 💞
_comandos de roleplay_\n
╭─── *INTERAÇÃO* ───
│ 💋 *${p}beijar* @user — beija (alias: ${p}beijo, ${p}beijinho)
│ 🤗 *${p}abraco* @user — abraça
│ 🥰 *${p}cafune* @user — faz cafuné
│ 👋 *${p}tapa* @user — dá um tapa
│ 👊 *${p}soco* @user — dá um soco
│ 😼 *${p}morder* @user — morde
│ 👅 *${p}lamber* @user — lambe
│ 🦶 *${p}chute* @user — chuta
│ 💀 *${p}matar* @user — mata (brincadeira)
│ 👉 *${p}cutucar* @user — cutuca
│ 🥺 *${p}cuddle* @user — aconchega
│ 🙌 *${p}highfive* @user — high five
╰───────────────

💡 *Uso:* marque com @ ou responda a mensagem da pessoa.
Ex: \`${p}beijar @Maria\` ou responda a mensagem dela com \`${p}beijar\``;
        await sock.sendMessage(from, { text }, { quoted: m });
        return current;
    }
};
