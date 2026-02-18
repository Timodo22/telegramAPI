const express = require('express');
const cors = require('cors');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

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
    console.log(`✅ Ingelogd! Klaar voor smart-scraping bij @${TARGET_BOT_USERNAME}`);
})();

app.post('/api/search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Geen query" });

    try {
        console.log(`📡 Query: '${query}' -> @${TARGET_BOT_USERNAME}`);

        await client.sendMessage(TARGET_BOT_USERNAME, { message: query });
        
        // Wacht op eerste antwoord
        await sleep(3500); 

        let messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
        let currentMsg = messages[0];

        if (!currentMsg || !currentMsg.text) {
            return res.json({ full_text: "Geen antwoord ontvangen van bot." });
        }

        let fullLog = currentMsg.text;
        let pageCount = 1;
        let maxPages = 1; // Standaard 1 pagina als we niks vinden

        // --- SMART PAGE DETECTION ---
        if (currentMsg.buttons) {
            const allButtons = currentMsg.buttons.flat();
            
            // Zoek een knop met het patroon "cijfer \ cijfer" of "cijfer / cijfer"
            // Voorbeeld: "1\19" of "1/10"
            const counterBtn = allButtons.find(btn => /\d+[\/\\]\d+/.test(btn.text));

            if (counterBtn) {
                // Haal de getallen eruit
                const match = counterBtn.text.match(/(\d+)[\/\\](\d+)/);
                if (match && match[2]) {
                    maxPages = parseInt(match[2]);
                    console.log(`📄 Smart Detectie: '${counterBtn.text}' -> We moeten tot pagina ${maxPages} gaan.`);
                }
            } else {
                console.log("⚠️ Geen teller-knop gevonden (bijv 1/19). We pakken alleen deze pagina.");
            }
        }

        // Veiligheidslimiet (voor het geval de bot zegt: 1/1000)
        if (maxPages > 20) {
            console.log(`⚠️ Limiet overschreden (${maxPages}). We cappen op 20 om timeout te voorkomen.`);
            maxPages = 20;
        }

        // --- DE LOOP ---
        // Hij stopt nu precies wanneer pageCount gelijk is aan maxPages
        while (pageCount < maxPages) {
            
            if (currentMsg.buttons) {
                let nextButton = null;
                const allButtons = currentMsg.buttons.flat();
                
                // Zoek de pijl
                nextButton = allButtons.find(btn => btn.text.includes("➡") || btn.text.includes("➡️"));

                // Fallback (laatste knop rij 1)
                if (!nextButton && currentMsg.buttons.length > 0) {
                     const row = currentMsg.buttons[0];
                     nextButton = row[row.length - 1]; 
                }

                if (nextButton && nextButton.data) {
                    console.log(`➡️ KLIK voor pagina ${pageCount + 1} van ${maxPages}`);
                    
                    try {
                        await client.invoke(
                            new Api.messages.GetBotCallbackAnswer({
                                peer: TARGET_BOT_USERNAME,
                                msgId: currentMsg.id,
                                data: nextButton.data, 
                            })
                        );
                    } catch (clickErr) {
                        console.error("Klik warning:", clickErr.message);
                    }

                    // Wacht op edit
                    await sleep(2500); 

                    // Refresh bericht
                    messages = await client.getMessages(TARGET_BOT_USERNAME, { limit: 1 });
                    currentMsg = messages[0];

                    fullLog += `\n\n================ PAGE ${pageCount + 1} ================\n` + currentMsg.text;
                    pageCount++;

                } else {
                    console.log("⏹️ Geen volgende knop, terwijl we nog niet klaar waren. Stop.");
                    break; 
                }
            } else {
                break;
            }
        }

        console.log(`✅ Klaar! ${pageCount}/${maxPages} pagina's opgehaald.`);
        res.json({ full_text: fullLog });

    } catch (error) {
        console.error("❌ Fout:", error);
        res.status(500).json({ error: "Interne fout: " + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server draait op poort ${PORT}`);
});
