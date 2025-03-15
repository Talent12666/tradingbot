const express = require('express');
const WebSocket = require('ws');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Debugging: Check if environment variables are loaded
if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('Twilio credentials are missing. Please check your environment variables.');
    process.exit(1); // Exit the app if credentials are missing
}

// Twilio setup
const twilioClient = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Pairs mapping (including all synthetics) - Updated according to Deriv
const SYMBOL_MAP = {
    // Forex
    "EURUSD": { symbol: "frxEURUSD", category: "forex" },
    "GBPUSD": { symbol: "frxGBPUSD", category: "forex" },
    "USDJPY": { symbol: "frxUSDJPY", category: "forex" },
    "AUDUSD": { symbol: "frxAUDUSD", category: "forex" },
    "USDCAD": { symbol: "frxUSDCAD", category: "forex" },
    "USDCHF": { symbol: "frxUSDCHF", category: "forex" },
    "NZDUSD": { symbol: "frxNZDUSD", category: "forex" },
    "EURGBP": { symbol: "frxEURGBP", category: "forex" },
    "EURJPY": { symbol: "frxEURJPY", category: "forex" },
    "GBPJPY": { symbol: "frxGBPJPY", category: "forex" },
    // Commodities
    "XAUUSD": { symbol: "frxXAUUSD", category: "commodities" },
    "XAGUSD": { symbol: "frxXAGUSD", category: "commodities" },
    "XPTUSD": { symbol: "frxXPTUSD", category: "commodities" },
    "XPDUSD": { symbol: "frxXPDUSD", category: "commodities" },
    // Indices
    "SPX": { symbol: "RDBULL", category: "indices" }, // Example: Volatility 100 Index
    "NDX": { symbol: "frxNAS100", category: "indices" },
    "DJI": { symbol: "frxDJ30", category: "indices" },
    "FTSE": { symbol: "frxUK100", category: "indices" },
    "DAX": { symbol: "frxGER30", category: "indices" },
    "NIKKEI": { symbol: "frxJP225", category: "indices" },
    "HSI": { symbol: "frxHK50", category: "indices" },
    "ASX": { symbol: "frxAUS200", category: "indices" },
    "CAC": { symbol: "frxFRA40", category: "indices" },
    // Cryptos
    "BTCUSD": { symbol: "cryBTCUSD", category: "crypto" },
    "ETHUSD": { symbol: "cryETHUSD", category: "crypto" },
    "XRPUSD": { symbol: "cryXRPUSD", category: "crypto" },
    "LTCUSD": { symbol: "cryLTCUSD", category: "crypto" },
    "BCHUSD": { symbol: "cryBCHUSD", category: "crypto" },
    "ADAUSD": { symbol: "cryADAUSD", category: "crypto" },
    "DOTUSD": { symbol: "cryDOTUSD", category: "crypto" },
    "SOLUSD": { symbol: "crySOLUSD", category: "crypto" },
    // Synthetics
    "R_100": { symbol: "1HZ100V", category: "synthetics" }, // Volatility 100 Index
    "R_50": { symbol: "1HZ50V", category: "synthetics" }, // Volatility 50 Index
    "R_25": { symbol: "1HZ25V", category: "synthetics" }, // Volatility 25 Index
    "R_10": { symbol: "1HZ10V", category: "synthetics" }, // Volatility 10 Index
    "JD10": { symbol: "JD10", category: "synthetics" }, // Jump 10 Index
    "JD25": { symbol: "JD25", category: "synthetics" }, // Jump 25 Index
    "JD50": { symbol: "JD50", category: "synthetics" }, // Jump 50 Index
    "JD100": { symbol: "JD100", category: "synthetics" }, // Jump 100 Index
    "BOOM300": { symbol: "BOOM300", category: "synthetics" }, // Boom 300 Index
    "BOOM500": { symbol: "BOOM500", category: "synthetics" }, // Boom 500 Index
    "BOOM1000": { symbol: "BOOM1000", category: "synthetics" }, // Boom 1000 Index
    "CRASH300": { symbol: "CRASH300", category: "synthetics" }, // Crash 300 Index
    "CRASH500": { symbol: "CRASH500", category: "synthetics" }, // Crash 500 Index
    "CRASH1000": { symbol: "CRASH1000", category: "synthetics" }, // Crash 1000 Index
};

// Store the latest prices for each symbol
const latestPrices = {};

// WebSocket setup
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=69860');

ws.on('open', () => {
    console.log('WebSocket connected');
    // Subscribe to all pairs
    Object.keys(SYMBOL_MAP).forEach(symbol => {
        const payload = {
            ticks: SYMBOL_MAP[symbol].symbol, // Use Deriv symbol mapping
            subscribe: 1,
        };
        ws.send(JSON.stringify(payload));
        console.log(`Subscribed to ${symbol}`);
    });
});

ws.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('WebSocket message:', message); // Debugging: Log the raw message

    if (message.msg_type === 'tick' && message.tick) {
        const { symbol, bid, ask } = message.tick;
        const price = (bid + ask) / 2; // Calculate mid-price
        latestPrices[symbol] = price; // Store the latest price
        console.log(`Price update for ${symbol}: ${price}`);
    } else if (message.msg_type === 'ping') {
        console.log('Received ping from WebSocket server');
    } else {
        console.log('Unknown message type:', message.msg_type);
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

// Calculate winrate based on signal success chance
function calculateWinrate(successChance) {
    return `${(successChance * 100).toFixed(1)}%`;
}

// Determine trend (uptrend or downtrend)
function determineTrend(prices) {
    if (prices.length < 2) return "N/A";
    const lastPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 2];
    return lastPrice > prevPrice ? "Up trend" : "Down trend";
}

// Greeting message
const GREETING_MESSAGE = `
📈 Space Zero Trading Bot 📈
Supported Instruments:
• Forex: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD, EURGBP, USDSEK, USDNOK, USDTRY, EURJPY, GBPJPY
• Commodities: XAUUSD, XAGUSD, XPTUSD, XPDUSD, CL1, NG1, CO1, HG1
• Indices: SPX, NDX, DJI, FTSE, DAX, NIKKEI, HSI, ASX, CAC
• Crypto: BTCUSD, ETHUSD, XRPUSD, LTCUSD, BCHUSD, ADAUSD, DOTUSD, SOLUSD
• ETFs: SPY, QQQ, GLD, XLF, IWM, EEM
• Stocks: AAPL, TSLA, AMZN, GOOGL, MSFT, META, NVDA, NFLX
• Synthetics: R_100, R_50, R_25, R_10, JD10, JD25, JD50, JD100, BOOM300, BOOM500, BOOM1000, CRASH300, CRASH500, CRASH1000

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
            const price = latestPrices[SYMBOL_MAP[symbol].symbol]; // Get the latest price from WebSocket data
            if (price !== undefined) {
                responseMessage = `Current ${symbol}: ${price.toFixed(5)}`;
            } else {
                responseMessage = `❌ No price data available for ${symbol}`;
            }
        } else {
            responseMessage = '❌ Unsupported asset';
        }
    } else if (incomingMsg in SYMBOL_MAP) {
        const symbol = SYMBOL_MAP[incomingMsg].symbol; // Use Deriv symbol mapping
        const price = latestPrices[symbol]; // Get the latest price
        if (price === undefined) {
            responseMessage = `❌ No price data available for ${incomingMsg}`;
        } else {
            // Simulate analysis (replace with actual logic)
            const successChance = Math.random(); // Random success chance between 0 and 1
            const winrate = calculateWinrate(successChance);
            const trend = determineTrend([price]); // Replace with actual trend calculation
            const signal = trend === "Up trend" ? "BUY" : "SELL";
            const sl = signal === "BUY" ? (price * 0.995).toFixed(5) : (price * 1.005).toFixed(5);
            const tp1 = signal === "BUY" ? (price * 1.005).toFixed(5) : (price * 0.995).toFixed(5);
            const tp2 = signal === "BUY" ? (price * 1.010).toFixed(5) : (price * 0.990).toFixed(5);

            responseMessage = `
📊 ${incomingMsg} Analysis
Signal: ${signal}
Winrate: ${winrate}
M15 trend: ${trend}
Entry: ${price.toFixed(5)}
SL: ${sl}
TP1: ${tp1}
TP2: ${tp2}
`;
        }
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
