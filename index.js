const express = require('express');
const WebSocket = require('ws');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Twilio setup
const twilioClient = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Pairs mapping (including all synthetics)
const SYMBOL_MAP = {
    // Forex
    "EURUSD": { symbol: "EUR/USD", category: "forex" },
    "GBPUSD": { symbol: "GBP/USD", category: "forex" },
    "USDJPY": { symbol: "USD/JPY", category: "forex" },
    "AUDUSD": { symbol: "AUD/USD", category: "forex" },
    "USDCAD": { symbol: "USD/CAD", category: "forex" },
    "USDCHF": { symbol: "USD/CHF", category: "forex" },
    "NZDUSD": { symbol: "NZD/USD", category: "forex" },
    "EURGBP": { symbol: "EUR/GBP", category: "forex" },
    "EURJPY": { symbol: "EUR/JPY", category: "forex" },
    "GBPJPY": { symbol: "GBP/JPY", category: "forex" },
    // Commodities
    "XAUUSD": { symbol: "Gold/USD", category: "commodities" },
    "XAGUSD": { symbol: "Silver/USD", category: "commodities" },
    "XPTUSD": { symbol: "Platinum/USD", category: "commodities" },
    "XPDUSD": { symbol: "Palladium/USD", category: "commodities" },
    // Indices
    "SPX": { symbol: "S&P 500", category: "indices" },
    "NDX": { symbol: "Nasdaq 100", category: "indices" },
    "DJI": { symbol: "Dow Jones", category: "indices" },
    "FTSE": { symbol: "FTSE 100", category: "indices" },
    "DAX": { symbol: "DAX 30", category: "indices" },
    "NIKKEI": { symbol: "Nikkei 225", category: "indices" },
    "HSI": { symbol: "Hang Seng", category: "indices" },
    "ASX": { symbol: "ASX 200", category: "indices" },
    "CAC": { symbol: "CAC 40", category: "indices" },
    // Cryptos
    "BTCUSD": { symbol: "BTC/USD", category: "crypto" },
    "ETHUSD": { symbol: "ETH/USD", category: "crypto" },
    "XRPUSD": { symbol: "XRP/USD", category: "crypto" },
    "LTCUSD": { symbol: "LTC/USD", category: "crypto" },
    "BCHUSD": { symbol: "BCH/USD", category: "crypto" },
    "ADAUSD": { symbol: "ADA/USD", category: "crypto" },
    "DOTUSD": { symbol: "DOT/USD", category: "crypto" },
    "SOLUSD": { symbol: "SOL/USD", category: "crypto" },
    // Synthetics
    "R_100": { symbol: "Volatility 100 Index", category: "synthetics" },
    "R_50": { symbol: "Volatility 50 Index", category: "synthetics" },
    "R_25": { symbol: "Volatility 25 Index", category: "synthetics" },
    "R_10": { symbol: "Volatility 10 Index", category: "synthetics" },
    "JD10": { symbol: "Jump 10 Index", category: "synthetics" },
    "JD25": { symbol: "Jump 25 Index", category: "synthetics" },
    "JD50": { symbol: "Jump 50 Index", category: "synthetics" },
    "JD100": { symbol: "Jump 100 Index", category: "synthetics" },
    "BOOM300": { symbol: "Boom 300 Index", category: "synthetics" },
    "BOOM500": { symbol: "Boom 500 Index", category: "synthetics" },
    "BOOM1000": { symbol: "Boom 1000 Index", category: "synthetics" },
    "CRASH300": { symbol: "Crash 300 Index", category: "synthetics" },
    "CRASH500": { symbol: "Crash 500 Index", category: "synthetics" },
    "CRASH1000": { symbol: "Crash 1000 Index", category: "synthetics" },
};

// WebSocket setup
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    console.log('WebSocket connected');
    // Subscribe to all pairs
    Object.keys(SYMBOL_MAP).forEach(symbol => {
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    });
});

ws.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.msg_type === 'tick') {
        const { symbol, bid, ask } = message.tick;
        const price = (bid + ask) / 2;
        console.log(`Price update for ${symbol}: ${price}`);
    }
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

ws.on('close', () => {
    console.log('WebSocket disconnected');
    // Reconnect after 5 seconds
    setTimeout(() => connect(), 5000);
});

// Twilio alert function
function sendWhatsAppAlert(user, message) {
    twilioClient.messages
        .create({
            body: message,
            from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
            to: `whatsapp:${user}`,
        })
        .then(() => console.log('Alert sent via WhatsApp'))
        .catch((error) => console.error('Twilio error:', error));
}

// Greeting message
const GREETING_MESSAGE = `
📈 ShadowFx Trading Bot 📈
Supported Instruments:
• Forex: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD, EURGBP, USDSEK, USDNOK, USDTRY, EURJPY, GBPJPY
• Commodities: XAUUSD, XAGUSD, XPTUSD, XPDUSD, CL1, NG1, CO1, HG1
• Indices: SPX, NDX, DJI, FTSE, DAX, NIKKEI, HSI, ASX, CAC
• Crypto: BTCUSD, ETHUSD, XRPUSD, LTCUSD, BCHUSD, ADAUSD, DOTUSD, SOLUSD
• ETFs: SPY, QQQ, GLD, XLF, IWM, EEM
• Stocks: AAPL, TSLA, AMZN, GOOGL, MSFT, META, NVDA, NFLX

Commands:
➤ Analysis: XAUUSD
➤ Price: PRICE BTCUSD
➤ Alert: ALERT SPX
`;

// Start the server
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/webhook', (req, res) => {
    const incomingMsg = req.body.Body.trim().toUpperCase();
    const userNumber = req.body.From;

    let responseMessage = '';

    if (incomingMsg === 'HI' || incomingMsg === 'HELLO' || incomingMsg === 'START') {
        responseMessage = GREETING_MESSAGE;
    } else if (incomingMsg.startsWith('PRICE ')) {
        const symbol = incomingMsg.split(' ')[1];
        if (SYMBOL_MAP[symbol]) {
            // Fetch price from WebSocket data (simulated here)
            const price = (Math.random() * 100).toFixed(5); // Replace with actual price logic
            responseMessage = `Current ${symbol}: ${price}`;
        } else {
            responseMessage = '❌ Unsupported asset';
        }
    } else if (incomingMsg in SYMBOL_MAP) {
        const symbol = incomingMsg;
        // Simulate analysis (replace with actual logic)
        responseMessage = `
📊 ${symbol} Analysis
Signal: BUY
Winrate: 75.5%
M15 trend: Up trend
Entry: 1800.50
SL: 1795.00
TP1: 1810.00
TP2: 1820.00
`;
    } else if (incomingMsg.startsWith('ALERT ')) {
        const symbol = incomingMsg.split(' ')[1];
        if (SYMBOL_MAP[symbol]) {
            responseMessage = `🔔 Alerts activated for ${symbol}`;
        } else {
            responseMessage = '❌ Unsupported asset';
        }
    } else {
        responseMessage = '❌ Invalid command. Send "HI" for help';
    }

    res.set('Content-Type', 'text/xml');
    res.send(`
        <Response>
            <Message>${responseMessage}</Message>
        </Response>
    `);
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
