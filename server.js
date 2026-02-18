const express = require('express');
const cors = require('cors');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
        await sleep(3500); 

        let messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
        let currentMsg = messages[0];

        if (!currentMsg || !currentMsg.text) {
            return res.json({ full_text: "Geen antwoord ontvangen van bot." });
        }

        let fullLog = currentMsg.text;
        let pageCount = 1;
        const MAX_PAGES = 19; // Jouw screenshot toonde 19 pagina's max

        // --- LOOP START ---
        while (pageCount < MAX_PAGES) {
            if (currentMsg.buttons) {
                
                // DEBUG: Laat zien wat de bot ziet in de console (check Render logs!)
                console.log(`--- PAGINA ${pageCount} KNOPPEN DEBUG ---`);
                currentMsg.buttons.forEach((row, i) => {
                    console.log(`Rij ${i}:`, row.map(b => `[Text: '${b.text}' | Data: ${b.data ? 'Ja' : 'Nee'}]`));
                });

                let nextButton = null;

                // STRATEGIE 1: Zoek op tekst (meerdere varianten)
                const allButtons = currentMsg.buttons.flat();
                const arrowVariations = ["➡️", "➡", "->", ">", "⏩", "Next"];
                
                nextButton = allButtons.find(btn => {
                    // We trimmen de tekst om spaties weg te halen
                    const cleanText = btn.text.trim();
                    return arrowVariations.includes(cleanText);
                });

                // STRATEGIE 2: Positie-hack (Als tekst faalt)
                // Op jouw screenshot is de knop ALTIJD de laatste in de eerste rij.
                if (!nextButton && currentMsg.buttons.length > 0) {
                    const firstRow = currentMsg.buttons[0];
                    // Als er 3 knoppen zijn [Terug, Teller, Verder], pak de laatste.
                    if (firstRow.length === 3) {
                        console.log("⚠️ Tekst match mislukt, we gebruiken positie-hack (laatste knop rij 1).");
                        nextButton = firstRow[2]; 
                    }
                    // Als er 2 knoppen zijn [Teller, Verder] (bij pagina 1), pak de laatste.
                    else if (firstRow.length === 2) {
                         console.log("⚠️ Tekst match mislukt, we gebruiken positie-hack (laatste knop rij 1).");
                         nextButton = firstRow[1];
                    }
                }

                if (nextButton) {
                    console.log(`➡️ KLIK OP: '${nextButton.text}'`);
                    
                    await nextButton.click();
                    
                    // Wacht op de edit van de bot
                    await sleep(3000); 

                    // Ververs bericht
                    messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
                    currentMsg = messages[0];

                    // Check of we niet per ongeluk hetzelfde bericht hebben (soms is bot traag)
                    // We voegen het alleen toe als het uniek lijkt of gewoon als afscheiding
                    fullLog += `\n\n================ PAGE ${pageCount + 1} ================\n` + currentMsg.text;
                    
                    pageCount++;
                } else {
                    console.log("⏹️ Geen 'Volgende' knop meer gevonden. Klaar.");
                    break; 
                }
            } else {
                console.log("Geen knoppen meer.");
                break;
            }
        }

        console.log(`✅ Klaar! Totaal ${pageCount} pagina's.`);
        res.json({ full_text: fullLog });

    } catch (error) {
        console.error("❌ Fout:", error);
        res.status(500).json({ error: "Interne server fout: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server draait op poort ${PORT}`);
});
