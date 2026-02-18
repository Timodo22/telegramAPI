const express = require('express');
const cors = require('cors');
const { TelegramClient, Api } = require("telegram"); // <--- Api toegevoegd!
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000; // Render gebruikt vaak 10000

// Helper: Pauze functie
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    console.log(`✅ Ingelogd! Klaar om te praten met @${TARGET_BOT_USERNAME}`);
})();

app.post('/api/search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Geen query" });

    try {
        console.log(`📡 Query: '${query}' -> @${TARGET_BOT_USERNAME}`);

        await client.sendMessage(TARGET_BOT_USERNAME, { message: query });
        
        // Wacht even op antwoord
        await sleep(3500); 

        let messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
        let currentMsg = messages[0];

        if (!currentMsg || !currentMsg.text) {
            return res.json({ full_text: "Geen antwoord ontvangen van bot." });
        }

        let fullLog = currentMsg.text;
        let pageCount = 1;
        const MAX_PAGES = 19; 

        // --- LOOP START ---
        while (pageCount < MAX_PAGES) {
            if (currentMsg.buttons) {
                
                let nextButton = null;

                // 1. Zoek de knop (je logs lieten zien dat '➡' werkt)
                const allButtons = currentMsg.buttons.flat();
                nextButton = allButtons.find(btn => btn.text.includes("➡") || btn.text.includes("➡️"));

                // 2. Fallback: pak de laatste knop van de eerste rij als tekst niet matcht
                if (!nextButton && currentMsg.buttons.length > 0) {
                     const row = currentMsg.buttons[0];
                     nextButton = row[row.length - 1]; 
                }

                if (nextButton && nextButton.data) {
                    console.log(`➡️ KLIK (Manual Invoke) op pagina ${pageCount}`);
                    
                    // --- DE FIX: HANDMATIGE KLIK ---
                    // We sturen direct een API request in plaats van de buggy .click() helper
                    try {
                        await client.invoke(
                            new Api.messages.GetBotCallbackAnswer({
                                peer: TARGET_BOT_USERNAME,
                                msgId: currentMsg.id,
                                data: nextButton.data, // De binaire data achter de knop
                            })
                        );
                    } catch (clickErr) {
                        console.error("Klik error (kan genegeerd worden als pagina update):", clickErr.message);
                    }

                    // Wacht tot de bot het bericht heeft aangepast (Edit)
                    // Dit moet lang genoeg zijn, Telegram bots zijn soms traag met editen
                    await sleep(3000); 

                    // Haal bericht opnieuw op
                    messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
                    currentMsg = messages[0];

                    // Voeg toe aan log
                    fullLog += `\n\n================ PAGE ${pageCount + 1} ================\n` + currentMsg.text;
                    pageCount++;

                } else {
                    console.log("⏹️ Geen 'Volgende' knop meer. Klaar.");
                    break; 
                }
            } else {
                break;
            }
        }

        console.log(`✅ Klaar! Totaal ${pageCount} pagina's.`);
        res.json({ full_text: fullLog });

    } catch (error) {
        console.error("❌ Fout:", error);
        res.status(500).json({ error: "Interne fout: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server draait op poort ${PORT}`);
});
