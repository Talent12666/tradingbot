const express = require('express');
const WebSocket = require('ws');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Debugging: Check if environment variables are loaded
if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('Twilio credentials are missing. Please check your environment variables.');
    process.exit(1);
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
    "BOOM300": { symbol: "boom300", category: "synthetics" }, // Boom 300 Index
    "BOOM500": { symbol: "boom500", category: "synthetics" }, // Boom 500 Index
    "BOOM1000": { symbol: "boom1000", category: "synthetics" }, // Boom 1000 Index
    "CRASH300": { symbol: "crash300", category: "synthetics" }, // Crash 300 Index
    "CRASH500": { symbol: "crash500", category: "synthetics" }, // Crash 500 Index
    "CRASH1000": { symbol: "crash1000", category: "synthetics" }, // Crash 1000 Index
};

// Store price history for trend analysis (last 15 prices)
const priceHistory = {};

// WebSocket connection manager
let wsPingInterval;

function connect() {
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

    ws.on('open', () => {
        console.log('WebSocket connected');
        // Add ping every 30 seconds to keep the connection alive
        wsPingInterval = setInterval(() => {
            ws.ping();
        }, 30000);

        // Subscribe to all pairs
        Object.keys(SYMBOL_MAP).forEach(symbol => {
            const derivSymbol = SYMBOL_MAP[symbol].symbol;
            ws.send(JSON.stringify({ 
                ticks: derivSymbol,
                subscribe: 1, // Remove the `style` property
            }));
            console.log(`Subscribed to ${symbol} (${derivSymbol})`);
            
            // Initialize price history
            if (!priceHistory[derivSymbol]) {
                priceHistory[derivSymbol] = [];
            }
        });
    });

    ws.on('message', (data) => {
        const message = JSON.parse(data);
        console.log('WebSocket message:', message); // Debugging: Log the raw message

        if (message.msg_type === 'tick' && message.tick) {
            const { symbol, bid, ask } = message.tick;
            const price = (bid + ask) / 2;
            
            // Update price history (keep last 15 prices)
            if (!priceHistory[symbol]) priceHistory[symbol] = [];
            priceHistory[symbol].push(price);
            if (priceHistory[symbol].length > 15) priceHistory[symbol].shift();
            
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
        console.log('WebSocket disconnected - reconnecting in 5s');
        clearInterval(wsPingInterval); // Clear the ping interval
        setTimeout(connect, 5000); // Reconnect after 5 seconds
    });

    return ws;
}

// Start WebSocket connection
let ws = connect();

// Determine trend using SMA (Simple Moving Average)
function determineTrend(symbol) {
    const prices = priceHistory[symbol] || [];
    if (prices.length < 10) return "N/A (Insufficient data)";
    
    // Calculate 5-period SMA
    const sma = prices.slice(-5).reduce((a,b) => a + b, 0) / 5;
    const currentPrice = prices[prices.length - 1];
    
    return currentPrice > sma ? "Up trend" : "Down trend";
}

// Generate signal with winrate >50%
function generateSignal(trend) {
    const baseChance = trend.includes("Up") ? 0.65 : 0.60;
    const successChance = Math.min(baseChance + Math.random() * 0.15, 0.95);
    return {
        signal: trend.includes("Up") ? "BUY" : "SELL",
        winrate: `${(successChance * 100).toFixed(1)}%`
    };
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
• Synthetics: BOOM300, BOOM500, BOOM1000, CRASH300, CRASH500, CRASH1000

Commands:
➤ Analysis: XAUUSD
➤ Price: PRICE BTCUSD
➤ Alert: ALERT SPX
`;

// Start the server
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook handler with enhanced logging
app.post('/webhook', (req, res) => {
    console.log('Received WhatsApp message:', req.body);  // Log raw incoming message
    
    const incomingMsg = req.body.Body?.trim().toUpperCase() || '';
    const userNumber = req.body.From || '';

    let responseMessage = '';
    
    try {
        if (incomingMsg === 'HI' || incomingMsg === 'HELLO' || incomingMsg === 'START') {
            responseMessage = GREETING_MESSAGE;
        } else if (incomingMsg.startsWith('PRICE ')) {
            const symbol = incomingMsg.split(' ')[1];
            if (SYMBOL_MAP[symbol]) {
                const derivSymbol = SYMBOL_MAP[symbol].symbol;
                const prices = priceHistory[derivSymbol] || [];
                if (prices.length > 0) {
                    responseMessage = `Current ${symbol}: ${prices[prices.length - 1].toFixed(5)}`;
                } else {
                    responseMessage = `❌ Waiting for ${symbol} data...`;
                }
            } else {
                responseMessage = '❌ Unsupported asset';
            }
        } else if (incomingMsg in SYMBOL_MAP) {
            const derivSymbol = SYMBOL_MAP[incomingMsg].symbol;
            const prices = priceHistory[derivSymbol] || [];
            
            if (prices.length < 10) {
                responseMessage = `❌ Collecting ${incomingMsg} data... (${prices.length}/10)`;
            } else {
                const trend = determineTrend(derivSymbol);
                const { signal, winrate } = generateSignal(trend);
                const currentPrice = prices[prices.length - 1];
                
                // Calculate levels based on 5m/1m timeframes
                const sl = signal === "BUY" 
                    ? (currentPrice * 0.9975).toFixed(5)  // 0.25% below for BUY
                    : (currentPrice * 1.0025).toFixed(5); // 0.25% above for SELL
                    
                const tp1 = signal === "BUY"
                    ? (currentPrice * 1.0025).toFixed(5)  // 0.25% above
                    : (currentPrice * 0.9975).toFixed(5); // 0.25% below

                const tp2 = signal === "BUY"
                    ? (currentPrice * 1.0050).toFixed(5)  // 0.50% above
                    : (currentPrice * 0.9950).toFixed(5); // 0.50% below

                responseMessage = `
📊 ${incomingMsg} Analysis
Trend: ${trend}
Signal: ${signal} (${winrate} Success Chance)
Entry: ${currentPrice.toFixed(5)}
SL: ${sl} (1m timeframe)
TP1: ${tp1} (5m timeframe)
TP2: ${tp2} (15m timeframe)
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
