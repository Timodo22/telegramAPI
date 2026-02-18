const express = require('express');
const cors = require('cors');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper om Markdown rommel (** en `) weg te halen
const cleanText = (text) => {
    if (!text) return "";
    return text
        .replace(/\*\*/g, '') // Haal vetgedrukte sterretjes weg
        .replace(/`/g, '')    // Haal code backticks weg
        .trim();
};

app.use(cors());
app.use(express.json());

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION; 
const TARGET_BOT_USERNAME = process.env.TARGET_BOT_USERNAME || "DehashedBot"; 

const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
});

(async () => {
    console.log("Verbinden met Telegram...");
    await client.connect();
    console.log(`✅ Ingelogd! Streaming mode active @${TARGET_BOT_USERNAME}`);
})();

app.post('/api/search', async (req, res) => {
    const { query } = req.body;
    
    // 1. Headers instellen voor STREAMING
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!query) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: "Geen query" })}\n\n`);
        return res.end();
    }

    try {
        console.log(`📡 Query: '${query}'`);
        
        // Meld aan frontend dat we beginnen
        res.write(`data: ${JSON.stringify({ type: 'status', message: "Connecting to Telegram Network...", page: 0, total: 0 })}\n\n`);

        await client.sendMessage(TARGET_BOT_USERNAME, { message: query });
        await sleep(3500); 

        let messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
        let currentMsg = messages[0];

        if (!currentMsg || !currentMsg.text) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: "Bot reageert niet." })}\n\n`);
            return res.end();
        }

        let pageCount = 1;
        let maxPages = 1; 

        // --- SMART PAGE DETECTION ---
        if (currentMsg.buttons) {
            const allButtons = currentMsg.buttons.flat();
            const counterBtn = allButtons.find(btn => /\d+[\/\\]\d+/.test(btn.text));

            if (counterBtn) {
                const match = counterBtn.text.match(/(\d+)[\/\\](\d+)/);
                if (match && match[2]) {
                    maxPages = parseInt(match[2]);
                }
            }
        }
        
        // Stuur totaal aantal pagina's naar frontend
        res.write(`data: ${JSON.stringify({ type: 'status', message: "Target Locked", page: 1, total: maxPages })}\n\n`);

        // Stuur de EERSTE pagina direct
        res.write(`data: ${JSON.stringify({ type: 'content', text: cleanText(currentMsg.text), page: 1 })}\n\n`);

        // --- DE LOOP (ZONDER LIMIET) ---
        // Let op: Render Free Tier stopt verbinding na 100 sec, maar we gaan door tot we crashen
        while (pageCount < maxPages) {
            
            if (currentMsg.buttons) {
                let nextButton = null;
                const allButtons = currentMsg.buttons.flat();
                
                // Zoek pijl
                nextButton = allButtons.find(btn => btn.text.includes("➡") || btn.text.includes("➡️"));
                
                // Fallback
                if (!nextButton && currentMsg.buttons.length > 0) {
                     const row = currentMsg.buttons[0];
                     nextButton = row[row.length - 1]; 
                }

                if (nextButton && nextButton.data) {
                    // Update frontend status
                    res.write(`data: ${JSON.stringify({ type: 'status', message: `Scraping page ${pageCount + 1}...`, page: pageCount + 1, total: maxPages })}\n\n`);
                    
                    try {
                        await client.invoke(
                            new Api.messages.GetBotCallbackAnswer({
                                peer: TARGET_BOT_USERNAME,
                                msgId: currentMsg.id,
                                data: nextButton.data, 
                            })
                        );
                    } catch (clickErr) {
                         // negeer klik fouten
                    }

                    // Iets korter wachten voor snelheid
                    await sleep(2200); 

                    messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
                    currentMsg = messages[0];

                    // Stuur het NIEUWE blok tekst naar frontend
                    res.write(`data: ${JSON.stringify({ type: 'content', text: cleanText(currentMsg.text), page: pageCount + 1 })}\n\n`);
                    
                    pageCount++;

                } else {
                    break; 
                }
            } else {
                break;
            }
        }

        res.write(`data: ${JSON.stringify({ type: 'done', message: "Scan Complete" })}\n\n`);
        res.end();

    } catch (error) {
        console.error("Error:", error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Streaming Server draait op poort ${PORT}`);
});
