const express = require('express');
const cors = require('cors');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Helper: Pauze functie (belangrijk voor Telegram edits)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.use(cors());
app.use(express.json());

// CONFIGURATIE (uit Render Environment)
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
    console.log(`✅ Ingelogd! Klaar om te praten met @${TARGET_BOT_USERNAME}`);
})();

app.post('/api/search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Geen query" });

    try {
        console.log(`📡 Query: '${query}' -> @${TARGET_BOT_USERNAME}`);

        // 1. Stuur commando
        await client.sendMessage(TARGET_BOT_USERNAME, { message: query });

        // 2. Wacht op EERSTE reactie (kan even duren)
        await sleep(3500); 

        // 3. Haal het laatste bericht op
        let messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
        let currentMsg = messages[0];

        if (!currentMsg || !currentMsg.text) {
            return res.json({ full_text: "Geen antwoord ontvangen van bot." });
        }

        // Variabele om alle tekst in op te slaan
        let fullLog = currentMsg.text;
        let pageCount = 1;
        const MAX_PAGES = 15; // Beveiliging: stop na 15 pagina's om vastlopen te voorkomen

        // 4. DE LOOP: Klikken op '➡️' tot het op is
        while (pageCount < MAX_PAGES) {
            // Check of er knoppen zijn
            if (currentMsg.buttons) {
                let nextButton = null;

                // Zoek de knop met het pijltje (flat() maakt 1 lijst van alle rijen)
                const allButtons = currentMsg.buttons.flat();
                nextButton = allButtons.find(btn => btn.text.includes("➡️") || btn.text.includes(">"));

                if (nextButton) {
                    console.log(`➡️ Gevonden! Klikken voor pagina ${pageCount + 1}...`);
                    
                    // KLIK!
                    await nextButton.click();

                    // CRUCIAAL: Wacht tot de bot de tekst heeft aangepast (Edit)
                    await sleep(2500); 

                    // Haal het bericht OPNIEUW op (want de tekst is veranderd in Telegram)
                    // We gebruiken 'limit: 1' omdat het bericht nu bovenaan staat of ge-edit is.
                    messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
                    currentMsg = messages[0];

                    // Voeg de nieuwe tekst toe aan onze grote log string
                    // We voegen een scheidingslijn toe voor de duidelijkheid
                    fullLog += `\n\n================ PAGE ${pageCount + 1} ================\n` + currentMsg.text;
                    
                    pageCount++;
                } else {
                    console.log("⏹️ Geen 'Volgende' knop meer gevonden. Klaar.");
                    break; // Stop de loop
                }
            } else {
                break; // Geen knoppen meer
            }
        }

        console.log(`✅ Klaar! Totaal ${pageCount} pagina's opgehaald.`);
        res.json({ full_text: fullLog });

    } catch (error) {
        console.error("❌ Fout:", error);
        res.status(500).json({ error: "Interne server fout: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server draait op poort ${PORT}`);
});
