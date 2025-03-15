const express = require('express');
const WebSocket = require('ws');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Debugging: Check environment variables
if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('Missing Twilio credentials!');
    process.exit(1);
}

// Twilio setup
const twilioClient = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Full list of all instruments including ALL synthetics and volatilities
const SYMBOL_MAP = {
    // Forex
    "EURUSD": "frxEURUSD", "GBPUSD": "frxGBPUSD", "USDJPY": "frxUSDJPY",
    "AUDUSD": "frxAUDUSD", "USDCAD": "frxUSDCAD", "USDCHF": "frxUSDCHF",
    "NZDUSD": "frxNZDUSD", "EURGBP": "frxEURGBP", "EURJPY": "frxEURJPY",
    "GBPJPY": "frxGBPJPY",
    
    // Commodities
    "XAUUSD": "frxXAUUSD", "XAGUSD": "frxXAGUSD", 
    "XPTUSD": "frxXPTUSD", "XPDUSD": "frxXPDUSD",
    
    // Indices
    "SPX": "RDBULL", "NDX": "frxNAS100", "DJI": "frxDJ30",
    "FTSE": "frxUK100", "DAX": "frxGER30", "NIKKEI": "frxJP225",
    "HSI": "frxHK50", "ASX": "frxAUS200", "CAC": "frxFRA40",
    
    // Cryptos
    "BTCUSD": "cryBTCUSD", "ETHUSD": "cryETHUSD", "XRPUSD": "cryXRPUSD",
    "LTCUSD": "cryLTCUSD", "BCHUSD": "cryBCHUSD", "ADAUSD": "cryADAUSD",
    "DOTUSD": "cryDOTUSD", "SOLUSD": "crySOLUSD",
    
    // All Volatilities
    "VOL10": "1HZ10V", "VOL25": "1HZ25V", "VOL50": "1HZ50V",
    "VOL75": "1HZ75V", "VOL100": "1HZ100V", "VOL150": "1HZ150V",
    "VOL250": "1HZ250V",
    
    // All Jumps
    "JUMP10": "JD10", "JUMP25": "JD25", "JUMP50": "JD50",
    "JUMP75": "JD75", "JUMP100": "JD100",
    
    // Boom/Crash
    "BOOM300": "boom300", "BOOM500": "boom500", "BOOM1000": "boom1000",
    "CRASH300": "crash300", "CRASH500": "crash500", "CRASH1000": "crash1000"
};

// Store price history for trend analysis (last 200 prices)
const priceHistory = {};

// WebSocket connection manager
let wsPingInterval;

function connect() {
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=69860');

    ws.on('open', () => {
        console.log('WS Connected');
        wsPingInterval = setInterval(() => ws.ping(), 30000);
        
        // Subscribe to ALL symbols
        Object.entries(SYMBOL_MAP).forEach(([name, derivSymbol]) => {
            ws.send(JSON.stringify({ ticks: derivSymbol, subscribe: 1 }));
            priceHistory[derivSymbol] = [];
            console.log(`Subscribed to ${name} (${derivSymbol})`);
        });
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        console.log('WebSocket message:', msg); // Log all incoming messages

        if (msg.msg_type === 'tick' && msg.tick) {
            const { symbol, bid, ask, quote } = msg.tick;
            const price = bid !== undefined ? (bid + ask) / 2 : quote;

            if (!priceHistory[symbol]) priceHistory[symbol] = [];
            priceHistory[symbol].push(price);
            if (priceHistory[symbol].length > 200) priceHistory[symbol].shift();

            console.log(`Price update for ${symbol}: ${price}`);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
        console.log('WebSocket disconnected - reconnecting in 5s');
        clearInterval(wsPingInterval); // Clear the ping interval
        setTimeout(connect, 5000); // Reconnect after 5 seconds
    });

    return ws;
}

// Start WebSocket connection
let ws = connect();

// Calculate EMA (Exponential Moving Average)
function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
}

// Determine trend using 21 EMA, 50 EMA, and 200 EMA
function determineTrend(symbol) {
    const prices = priceHistory[symbol] || [];
    const ema21 = calculateEMA(prices, 21);
    const ema50 = calculateEMA(prices, 50);
    const ema200 = calculateEMA(prices, 200);

    if (!ema21 || !ema50 || !ema200) return "N/A (Insufficient data)";

    // Trend confirmation
    if (prices[prices.length - 1] > ema200) {
        return "Bullish";
    } else if (prices[prices.length - 1] < ema200) {
        return "Bearish";
    } else {
        return "Neutral";
    }
}

// Generate signal based on EMA crossovers
function generateSignal(symbol) {
    const prices = priceHistory[symbol] || [];
    const ema21 = calculateEMA(prices, 21);
    const ema50 = calculateEMA(prices, 50);

    if (!ema21 || !ema50) return { signal: "N/A", confidence: "N/A" };

    if (ema21 > ema50) {
        return { signal: "BUY", confidence: "High" };
    } else if (ema21 < ema50) {
        return { signal: "SELL", confidence: "High" };
    } else {
        return { signal: "Hold", confidence: "Low" };
    }
}

// Calculate SL and TP
function calculateLevels(prices, signal) {
    const currentPrice = prices[prices.length - 1];
    const swingLow = Math.min(...prices.slice(-10));
    const swingHigh = Math.max(...prices.slice(-10));

    if (signal === "BUY") {
        const sl = swingLow;
        const tp1 = currentPrice + (currentPrice - sl) * 2;
        const tp2 = tp1 + (tp1 - currentPrice);
        return { sl, tp1, tp2 };
    } else if (signal === "SELL") {
        const sl = swingHigh;
        const tp1 = currentPrice - (sl - currentPrice) * 2;
        const tp2 = tp1 - (currentPrice - tp1);
        return { sl, tp1, tp2 };
    } else {
        return { sl: "N/A", tp1: "N/A", tp2: "N/A" };
    }
}

// Greeting message
const GREETING_MESSAGE = `
📈 Space Zero Bot - Supported Assets:
• Forex: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD, EURGBP
• Commodities: XAUUSD, XAGUSD, XPTUSD, XPDUSD
• Indices: SPX, NDX, DJI, FTSE, DAX, NIKKEI, HSI, ASX, CAC
• Crypto: BTCUSD, ETHUSD, XRPUSD, LTCUSD, BCHUSD, ADAUSD, DOTUSD, SOLUSD
• Volatilities: VOL10, VOL25, VOL50, VOL75, VOL100, VOL150, VOL250
• Jumps: JUMP10, JUMP25, JUMP50, JUMP75, JUMP100
• Boom/Crash: BOOM300, BOOM500, BOOM1000, CRASH300, CRASH500, CRASH1000

Commands:
➤ Analysis: XAUUSD
➤ Price: PRICE BTCUSD
➤ Alert: ALERT SPX
`;

// Apply body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook handler with enhanced logging
app.post('/webhook', (req, res) => {
    console.log('Incoming request headers:', req.headers);
    console.log('Incoming request body:', req.body);

    if (!req.body) {
        return res.status(400).send('Bad Request: No body provided');
    }

    const incomingMsg = req.body.Body?.trim().toUpperCase() || '';
    const userNumber = req.body.From || '';

    let responseMessage = '';
    
    try {
        if (incomingMsg === 'HI' || incomingMsg === 'HELLO' || incomingMsg === 'START') {
            responseMessage = GREETING_MESSAGE;
        } else if (incomingMsg.startsWith('PRICE ')) {
            const symbol = incomingMsg.split(' ')[1];
            if (SYMBOL_MAP[symbol]) {
                const derivSymbol = SYMBOL_MAP[symbol];
                const prices = priceHistory[derivSymbol] || [];
                if (prices.length > 0) {
                    responseMessage = `Current ${symbol}: ${prices[prices.length - 1].toFixed(5)}`;
                } else {
                    responseMessage = `❌ No price data received yet for ${symbol}.`;
                }
            } else {
                responseMessage = '❌ Unsupported asset';
            }
        } else if (incomingMsg in SYMBOL_MAP) {
            const derivSymbol = SYMBOL_MAP[incomingMsg];
            const prices = priceHistory[derivSymbol] || [];
            const currentPrice = prices.length > 0 ? prices[prices.length - 1] : null;

            if (!currentPrice) {
                responseMessage = `❌ No price data received yet for ${incomingMsg}.`;
            } else {
                const trend = determineTrend(derivSymbol);
                const { signal, confidence } = generateSignal(derivSymbol);
                const { sl, tp1, tp2 } = calculateLevels(prices, signal);

                responseMessage = `
📊 ${incomingMsg} Analysis
Trend: ${trend}
Signal: ${signal} (${confidence} Confidence)
Entry: ${currentPrice.toFixed(5)}
SL: ${sl.toFixed(5)}
TP1: ${tp1.toFixed(5)}
TP2: ${tp2.toFixed(5)}
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
    } catch (error) {
        console.error('Error processing message:', error);
        responseMessage = '⚠️ Bot encountered an error. Please try again.';
    }

    // Always respond with valid TwiML
    console.log('Sending response:', responseMessage);  // Log outgoing response
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
