import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import authRoutes from './routes/auth/auth.js';
import inboundRoutes from './routes/inbound/inbound.js';
import outboundRoutes from './routes/outbound/outbound.js';
import dashboardRoutes from './routes/dashboard/dashboard.js';
import googleRoutes from './routes/google/google.js';
import { StreamHandler } from './services/streamHandler.js';
import mongoose from 'mongoose';
import { broadcastService } from './services/broadcast.js';

const app = express();
const PORT = process.env.PORT || 5051;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (req.path !== '/health') console.log(`${req.method} ${req.path}`);
    next();
});

import { inboundCall } from './routes/inbound/inbound.controller.js';

app.use('/api/auth', authRoutes);
app.use('/inbound', inboundRoutes);
app.post('/outbound-start', inboundCall);
app.use('/trigger-outbound', outboundRoutes);
app.post('/call-complete', (req, res) => {
    console.log('Call complete webhook received from Twilio');
    res.status(200).send('OK');
});
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/google', googleRoutes);

app.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Real-State AI Agent is Live' });
})

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Create TWO separate WebSocket servers
const voiceWss = new WebSocketServer({ noServer: true });
const dashboardWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;
    console.log(`[Upgrade Request] Path: ${pathname}`);

    if (pathname === '/stream') {
        console.log('Upgrading to Voice WebSocket...');
        voiceWss.handleUpgrade(request, socket, head, (ws) => {
            voiceWss.emit('connection', ws, request);
        });
    } else if (pathname === '/dashboard') {
        console.log('Upgrading to Dashboard WebSocket...');
        dashboardWss.handleUpgrade(request, socket, head, (ws) => {
            dashboardWss.emit('connection', ws, request);
        });
    } else {
        console.log(`Unknown upgrade path: ${pathname}`);
        socket.destroy();
    }
});

// Telephony Stream Logic
voiceWss.on('connection', (ws, req) => {
    console.log('Twilio connected to audio stream');
    let streamHandler = null;

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            switch (msg.event) {
                case 'start':
                    const streamSid = msg.start.streamSid;
                    const callSid = msg.start.callSid;
                    const params = msg.start.customParameters || {};
                    const leadData = {
                        name: params.name || '',
                        phone: params.phone || '',
                        property: params.property || '',
                        budget: params.budget || '',
                        agentId: params.agentId || '',
                        callSid: callSid
                    };
                    console.log(`[${streamSid}] Stream started for call: ${callSid}`);
                    streamHandler = new StreamHandler(ws, streamSid, leadData);
                    streamHandler.init();
                    break;
                case 'media':
                    if (streamHandler) streamHandler.handleMedia(msg.media.payload);
                    break;
                case 'stop':
                    if (streamHandler) streamHandler.close('Twilio STOP event');
                    break;
            }
        } catch (e) {
            console.error('Error parsing Twilio message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Twilio WebSocket closed');
        if (streamHandler) streamHandler.close('Twilio WS Close');
    });
});

// Dashboard Logic
dashboardWss.on('connection', (ws) => {
    broadcastService.addClient(ws);
});
