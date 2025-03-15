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

// Full list of all instruments including ALL synthetics
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

const priceHistory = {};

// WebSocket Manager
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
            if (priceHistory[symbol].length > 20) priceHistory[symbol].shift();

            console.log(`Price update for ${symbol}: ${price}`);
        }
    });

    ws.on('close', () => {
        clearInterval(wsPingInterval);
        setTimeout(connect, 5000);
    });

    return ws;
}

let ws = connect();

// Greeting message
const GREETING = `📈 Trading Bot - Supported Assets:
Forex: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD, EURGBP
Commodities: XAUUSD, XAGUSD, XPTUSD, XPDUSD
Indices: SPX, NDX, DJI, FTSE, DAX, NIKKEI, HSI, ASX, CAC
Crypto: BTCUSD, ETHUSD, XRPUSD, LTCUSD, BCHUSD, ADAUSD, DOTUSD, SOLUSD
Volatilities: VOL10, VOL25, VOL50, VOL75, VOL100, VOL150, VOL250
Jumps: JUMP10, JUMP25, JUMP50, JUMP75, JUMP100
Boom/Crash: BOOM300/500/1000, CRASH300/500/1000

Commands: 
➤ Analysis: XAUUSD
➤ Price: PRICE BTCUSD`;

// Apply body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook Handler
app.post('/webhook', (req, res) => {
    console.log('Incoming request headers:', req.headers);
    console.log('Incoming request body:', req.body);

    if (!req.body) {
        return res.status(400).send('Bad Request: No body provided');
    }

    const msg = req.body.Body?.trim().toUpperCase() || '';
    let response = '';
    
    try {
        if (msg === 'HI') response = GREETING;
        else if (msg.startsWith('PRICE ')) {
            const asset = msg.split(' ')[1];
            const derivSymbol = SYMBOL_MAP[asset];
            if (!derivSymbol) {
                response = "❌ Invalid asset";
            } else if (!priceHistory[derivSymbol]?.length) {
                response = `❌ No price data received yet for ${asset}. Try again later.`;
            } else {
                response = `${asset}: ${priceHistory[derivSymbol].slice(-1)[0].toFixed(5)}`;
            }
        }
        else if (SYMBOL_MAP[msg]) {
            const derivSymbol = SYMBOL_MAP[msg];
            const prices = priceHistory[derivSymbol] || [];
            
            if (prices.length < 15) {
                response = `🔄 Collecting data (${prices.length}/15)`;
            } else {
                const trend = analyzeTrend(prices);
                const currentPrice = prices.slice(-1)[0];
                const signal = generateSignal(trend);
                
                response = `📊 ${msg} Analysis
Trend: ${trend}
Signal: ${signal.direction} (${signal.confidence})
Entry: ${currentPrice.toFixed(5)}
SL: ${signal.sl(currentPrice)}
TP: ${signal.tp1(currentPrice)}`;
            }
        }
        else response = "Invalid command";
    } catch (err) {
        console.error('Error processing request:', err);
        response = "Error processing request";
    }

    res.set('Content-Type', 'text/xml').send(`
        <Response><Message>${response}</Message></Response>
    `);
});

app.listen(port, () => console.log(`Running on ${port}`));
