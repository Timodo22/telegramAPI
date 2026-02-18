const express = require('express');
const cors = require('cors');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { Button } = require("telegram/tl/custom/button");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Helper: Even wachten (sleep)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.use(cors());
app.use(express.json());

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION; 
const TARGET_BOT_USERNAME = "DehashedBot"; // Hardcoded voor zekerheid, of gebruik env

const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
});

(async () => {
    console.log("Verbinden met Telegram...");
    await client.connect();
    console.log(`✅ Ingelogd! Klaar voor actie met @${TARGET_BOT_USERNAME}`);
})();

app.post('/api/search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Geen query" });

    try {
        console.log(`📡 Query: '${query}' -> @${TARGET_BOT_USERNAME}`);

        // 1. Stuur bericht
        await client.sendMessage(TARGET_BOT_USERNAME, { message: query });

        // 2. WACHT STRATEGIE:
        // De bot stuurt eerst een "Summary" bericht, en DAARNA pas de resultaten.
        // We wachten even 3 seconden om zeker te zijn dat alle berichten binnen zijn.
        await sleep(3000); 

        // 3. Haal de laatste berichten op uit de chat
        const messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 3 });
        
        // Zoek het bericht dat de DATA bevat (niet de samenvatting).
        // De samenvatting bevat vaak "Request:", de data bevat "Email:" of "Password:".
        let resultMsg = messages.find(m => m.text && (m.text.includes("Email:") || m.text.includes("Password:")));

        // Als we geen data bericht vinden, pakken we gewoon het allerlaatste bericht
        if (!resultMsg) resultMsg = messages[0];

        if (!resultMsg) {
            return res.json({ full_text: "Geen resultaten ontvangen van de bot." });
        }

        let fullLog = resultMsg.text;

        // 4. PAGINATION LOOP (Automatisch bladeren)
        // We kijken of er knoppen zijn en proberen op '➡️' te klikken.
        let pageCount = 0;
        const MAX_PAGES = 5; // Veiligheid: max 5 pagina's ophalen

        while (pageCount < MAX_PAGES) {
            if (resultMsg.buttons) {
                // Zoek de knop met het pijltje naar rechts
                // Vaak is dit een emoji of specifieke text. In jouw screenshot is het de rechter knop.
                // We zoeken plat naar een knop die 'Next' of een pijl suggereert in de data, 
                // maar bij GramJS kunnen we vaak gewoon de componenten scannen.
                
                let nextButton = null;
                
                // Doorzoek rijen en knoppen
                for (const row of resultMsg.buttons) {
                    for (const btn of row) {
                        if (btn.text.includes("➡️") || btn.text.includes(">")) {
                            nextButton = btn;
                        }
                    }
                }

                if (nextButton) {
                    console.log(`➡️ Pagina ${pageCount + 1}: Klikken op volgende...`);
                    
                    // Klik op de knop
                    await nextButton.click();
                    
                    // Wacht tot de bot het bericht heeft aangepast (edit)
                    await sleep(2000); 

                    // Haal het bericht opnieuw op (het is ge-edit in plaats van nieuw verstuurd)
                    const updatedMsgs = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
                    resultMsg = updatedMsgs[0];
                    
                    // Voeg de nieuwe tekst toe aan onze log (met een scheidingslijn)
                    fullLog += `\n\n--- PAGE ${pageCount + 2} ---\n` + resultMsg.text;
                    pageCount++;
                } else {
                    break; // Geen volgende knop meer
                }
            } else {
                break; // Geen knoppen überhaupt
            }
        }

        // 5. Stuur ALLES terug als één string
        res.json({ full_text: fullLog });

    } catch (error) {
        console.error("❌ Fout:", error);
        res.status(500).json({ error: "Interne fout bij ophalen data." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server draait op poort ${PORT}`);
});
