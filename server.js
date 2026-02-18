const express = require('express');
const cors = require('cors');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Helper: Pauze
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Markdown Cleanen (** en ` weghalen)
const cleanText = (text) => {
    if (!text) return "";
    return text.replace(/\*\*/g, '').replace(/`/g, '').trim();
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
    console.log(`✅ Ingelogd! Ready for streaming @${TARGET_BOT_USERNAME}`);
})();

// LET OP: Dit is nu app.GET geworden voor streaming!
app.get('/api/stream_search', async (req, res) => {
    // We halen de query nu uit de URL (?q=...)
    const query = req.query.q;

    // Headers voor Server-Sent Events (SSE)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    if (!query) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: "Geen query opgegeven" })}\n\n`);
        return res.end();
    }

    try {
        console.log(`📡 Start Stream voor: '${query}'`);
        
        // Direct een signaal sturen zodat de frontend weet dat de verbinding leeft
        res.write(`data: ${JSON.stringify({ type: 'status', message: "Connecting to Telegram...", page: 0, total: 0 })}\n\n`);

        await client.sendMessage(TARGET_BOT_USERNAME, { message: query });
        await sleep(3000); // Wacht op bot reactie

        let messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
        let currentMsg = messages[0];

        if (!currentMsg || !currentMsg.text) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: "Geen reactie van bot." })}\n\n`);
            return res.end();
        }

        let pageCount = 1;
        let maxPages = 1; 

        // Smart Page Detection
        if (currentMsg.buttons) {
            const allButtons = currentMsg.buttons.flat();
            const counterBtn = allButtons.find(btn => /\d+[\/\\]\d+/.test(btn.text));
            if (counterBtn) {
                const match = counterBtn.text.match(/(\d+)[\/\\](\d+)/);
                if (match && match[2]) maxPages = parseInt(match[2]);
            }
        }
        
        res.write(`data: ${JSON.stringify({ type: 'status', message: "Target Locked", page: 1, total: maxPages })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'content', text: cleanText(currentMsg.text), page: 1 })}\n\n`);

        // Loop
        while (pageCount < maxPages) {
            if (currentMsg.buttons) {
                let nextButton = null;
                const allButtons = currentMsg.buttons.flat();
                
                // Zoek pijl
                nextButton = allButtons.find(btn => btn.text.includes("➡") || btn.text.includes("➡️"));
                
                // Fallback (laatste knop)
                if (!nextButton && currentMsg.buttons.length > 0) {
                     const row = currentMsg.buttons[0];
                     nextButton = row[row.length - 1]; 
                }

                if (nextButton && nextButton.data) {
                    // Update status naar frontend
                    res.write(`data: ${JSON.stringify({ type: 'status', message: `Scraping page ${pageCount + 1}...`, page: pageCount + 1, total: maxPages })}\n\n`);
                    
                    try {
                        await client.invoke(
                            new Api.messages.GetBotCallbackAnswer({
                                peer: TARGET_BOT_USERNAME,
                                msgId: currentMsg.id,
                                data: nextButton.data, 
                            })
                        );
                    } catch (e) { /* negeer klik fouten */ }

                    await sleep(2200); // Wacht op edit

                    messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
                    currentMsg = messages[0];

                    res.write(`data: ${JSON.stringify({ type: 'content', text: cleanText(currentMsg.text), page: pageCount + 1 })}\n\n`);
                    pageCount++;
                } else {
                    break; 
                }
            } else {
                break;
            }
        }

        res.write(`data: ${JSON.stringify({ type: 'done', message: "Scan voltooid" })}\n\n`);
        res.end();

    } catch (error) {
        console.error("Stream Error:", error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Streaming Server draait op poort ${PORT}`);
});
