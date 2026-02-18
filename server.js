const express = require('express');
const cors = require('cors');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// CONFIGURATIE UIT RENDER ENVIRONMENT
const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION; 
const TARGET_BOT_USERNAME = process.env.TARGET_BOT_USERNAME; // Bijv: 'LeakOSINT_bot'

// Controleer of configuratie bestaat
if (!apiId || !apiHash || !sessionString || !TARGET_BOT_USERNAME) {
    console.error("FATALE FOUT: Ontbrekende Environment Variables! Check je Render dashboard.");
    process.exit(1);
}

// Start de Telegram Client (Userbot)
const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
});

(async () => {
    console.log("Verbinden met Telegram server...");
    await client.connect();
    console.log(`✅ Ingelogd! Klaar om berichten te sturen naar @${TARGET_BOT_USERNAME}`);
})();

// API Endpoint
app.post('/api/search', async (req, res) => {
    const { query } = req.body;

    if (!query) return res.status(400).json({ error: "Geen query opgegeven" });

    try {
        console.log(`📡 Query: '${query}' -> @${TARGET_BOT_USERNAME}`);

        // 1. Stuur bericht naar de externe bot
        await client.sendMessage(TARGET_BOT_USERNAME, { message: query });

        // 2. Wacht op antwoord
        const antwoord = await waitForBotResponse(client, TARGET_BOT_USERNAME);

        // 3. Stuur terug naar frontend
        const responseData = [{
            source: `@${TARGET_BOT_USERNAME}`,
            email: query,
            info: antwoord.text || "Geen tekst in antwoord",
            date: new Date().toLocaleDateString(),
            password: "Zie resultaat", 
            details: { full_response: antwoord.text }
        }];

        res.json(responseData);

    } catch (error) {
        console.error("❌ Fout:", error);
        res.status(500).json({ error: error || "Timeout of interne fout." });
    }
});

// Helper functie: Wacht op specifiek antwoord
function waitForBotResponse(client, botUsername) {
    return new Promise((resolve, reject) => {
        // Timeout na 20 seconden
        const timeout = setTimeout(() => {
            client.removeEventHandler(handler);
            reject("Timeout: Bot reageerde niet binnen 20 seconden.");
        }, 20000);

        const handler = (event) => {
            // We luisteren naar nieuwe berichten. 
            // We gaan er even simpelweg van uit dat het eerstvolgende bericht in deze chat het antwoord is.
            if (event.message && event.message.text) {
                clearTimeout(timeout);
                client.removeEventHandler(handler);
                resolve(event.message);
            }
        };

        // Luister alleen naar events in de chat met de specifieke bot
        client.addEventHandler(handler, new NewMessage({ chats: [botUsername] }));
    });
}

app.listen(PORT, () => {
    console.log(`🚀 Server draait op poort ${PORT}`);
});
