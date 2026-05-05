import { Deepgram } from '@deepgram/sdk';
import Anthropic from '@anthropic-ai/sdk';
import { WebSocket } from 'ws';
import { processCallOutcome, logSystemEvent } from './logger.js';
import Call from '../models/Call.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { broadcastService } from './broadcast.js';

export class StreamHandler {
    constructor(ws, streamSid, leadData = {}) {
        this.twillioWs = ws;
        this.streamSid = streamSid;
        this.deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
        this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        this.elevenLabsWs = null;
        this.dgConnection = null;
        
        this.leadData = leadData;
        const isOutbound = leadData && leadData.name;
        
        this.silenceTimeout = null;
        this.isAssistantSpeaking = false;
        this.chatHistory = [];

        // Broadcast that a call has started
        broadcastService.broadcast('CALL_STATUS', {
            streamSid: this.streamSid,
            status: 'In Progress',
            leadData: this.leadData
        });

        const promptPath = path.join(__dirname, '../config/system_prompt.txt');
        let systemPrompt = '';
        try {
            systemPrompt = fs.readFileSync(promptPath, 'utf8');
        } catch (err) {
            console.error('Failed to read system prompt file:', err);
            systemPrompt = `You are Alex, a professional AI Real Estate Agent working for "Bitzsol Realty". Keep responses under 2 sentences.`;
        }

        if (isOutbound) {
            systemPrompt += `\nOUTBOUND CALL CONTEXT:
You are making an outbound call to ${leadData.name}. 
They recently submitted an inquiry or viewed ${leadData.property || 'one of our properties'} (Lead Source: Website/CRM). 
Goal: Open with a personalized greeting referencing their name and specific inquiry. Ask how you can help them with their search today.`;
        } else {
            systemPrompt += `\nINBOUND CALL CONTEXT:
You are receiving an inbound call. A potential lead is calling to inquire about properties.
Goal: Be helpful, professional, and try to qualify them by asking about their budget, property of interest, and timeline.`;
        }

        this.systemPrompt = systemPrompt;
    }

    async init() {
        console.log(`[${this.streamSid}] Initializing StreamHandler...`);
        logSystemEvent('CALL_START', { streamSid: this.streamSid, leadData: this.leadData });
        
        // Save to Database
        try {
            await Call.create({
                streamSid: this.streamSid,
                agentId: this.leadData.agentId,
                leadName: this.leadData.name,
                phoneNumber: this.leadData.phone,
                property: this.leadData.property,
                budget: this.leadData.budget,
                status: 'In Progress'
            });
            console.log(`[${this.streamSid}] Call record created in DB`);
        } catch (err) {
            console.error(`[${this.streamSid}] Failed to create call record:`, err);
        }

        this.setupDeepgram();
        this.setupElevenLabs();

        // Trigger initial greeting
        console.log(`[${this.streamSid}] Triggering initial greeting...`);
        this.processWithLLM("");
    }

    setupDeepgram() {
        this.dgConnection = this.deepgram.listen.live({
            model: 'nova-2',
            language: 'en-US',
            smart_format: true,
            encoding: 'mulaw',
            sample_rate: 8000,
            channels: 1,
            endpointing: 300,
            interim_results: true,
        });

        this.dgConnection.on('open', () => {
            console.log(`[${this.streamSid}] Deepgram STT Connected`);
        });

        this.dgConnection.on('Results', async (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript.trim() !== '') {
                console.log(`[${this.streamSid}] User: ${transcript}`);
                
                // Broadcast user transcript
                broadcastService.broadcast('USER_TRANSCRIPT', {
                    streamSid: this.streamSid,
                    text: transcript,
                    isFinal: data.is_final
                });

                if (data.is_final) {
                    this.clearSilenceTimeout();
                    
                    // Save to DB
                    await Call.updateOne(
                        { streamSid: this.streamSid },
                        { $push: { transcripts: { role: 'user', text: transcript } } }
                    );

                    this.processWithLLM(transcript);
                }
            }
        });

        this.dgConnection.on('error', (err) => {
            console.error(`[${this.streamSid}] Deepgram Error:`, err);
        });
    }

    setupElevenLabs() {
        const voiceId = process.env.ELEVENLABS_VOICE_ID;
        const model = 'eleven_turbo_v2_5';
        const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}&output_format=ulaw_8000`;

        this.elevenLabsWs = new WebSocket(wsUrl, {
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
            }
        });

        this.elevenLabsWs.on('open', () => {
            console.log(`[${this.streamSid}] ElevenLabs TTS Connected`);
            this.elevenLabsWs.send(JSON.stringify({
                text: " ",
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
            }));
        });

        this.elevenLabsWs.on('message', (data) => {
            const response = JSON.parse(data);
            if (response.audio) {
                // Send audio back to Twilio
                this.twillioWs.send(JSON.stringify({
                    event: 'media',
                    streamSid: this.streamSid,
                    media: {
                        payload: response.audio
                    }
                }));
            }
        });

        this.elevenLabsWs.on('error', (err) => console.error(`[${this.streamSid}] ElevenLabs Error:`, err));
    }

    async processWithLLM(userText) {
        if (userText) {
            console.log(`[${this.streamSid}] Processing user text: "${userText}"`);
            this.chatHistory.push({ role: 'user', content: userText });

            // Filler audio
            const fillers = ["Let me check that for you.", "One moment.", "Sure, give me just a second."];
            const filler = fillers[Math.floor(Math.random() * fillers.length)];
            if (this.elevenLabsWs && this.elevenLabsWs.readyState === WebSocket.OPEN) {
                this.elevenLabsWs.send(JSON.stringify({ text: filler, try_trigger_generation: true }));
            }
        }

        try {
            console.log(`[${this.streamSid}] Calling Claude API...`);
            const stream = await this.anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 150,
                system: this.systemPrompt,
                messages: this.chatHistory,
                stream: true,
            });

            let fullResponse = '';

            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
                    const text = chunk.delta.text || '';
                    if (text) {
                        fullResponse += text;
                        if (this.elevenLabsWs && this.elevenLabsWs.readyState === WebSocket.OPEN) {
                            this.elevenLabsWs.send(JSON.stringify({ text, try_trigger_generation: true }));
                        }
                    }
                }
            }

            console.log(`[${this.streamSid}] Agent: ${fullResponse}`);
            this.chatHistory.push({ role: 'assistant', content: fullResponse });

            // Save to DB
            await Call.updateOne(
                { streamSid: this.streamSid },
                { $push: { transcripts: { role: 'agent', text: fullResponse } } }
            );

            // Broadcast agent transcript
            broadcastService.broadcast('AGENT_TRANSCRIPT', {
                streamSid: this.streamSid,
                text: fullResponse
            });

            if (this.elevenLabsWs && this.elevenLabsWs.readyState === WebSocket.OPEN) {
                this.elevenLabsWs.send(JSON.stringify({ text: " " }));
            }

            this.startSilenceTimeout();

        } catch (error) {
            logSystemEvent('LLM_ERROR', { streamSid: this.streamSid, error: error.message });
            console.error(`[${this.streamSid}] Anthropic Error:`, error);
        }
    }

    handleMedia(payload) {
        if (this.dgConnection && this.dgConnection.getReadyState() === 1) {
            const audioBuffer = Buffer.from(payload, 'base64');
            this.dgConnection.send(audioBuffer);
        }
    }

    async close(reason = 'Unknown') {
        console.log(`[${this.streamSid}] Closing StreamHandler. Reason: ${reason}`);
        logSystemEvent('CALL_END', { streamSid: this.streamSid, reason });
        this.clearSilenceTimeout();
        
        // Update DB
        await Call.updateOne(
            { streamSid: this.streamSid },
            { status: 'Ended', endTime: Date.now() }
        );

        // Broadcast call end
        broadcastService.broadcast('CALL_STATUS', {
            streamSid: this.streamSid,
            status: 'Ended'
        });

        if (this.dgConnection) this.dgConnection.finish();
        if (this.elevenLabsWs && this.elevenLabsWs.readyState === WebSocket.OPEN) {
            this.elevenLabsWs.send(JSON.stringify({ text: "" }));
        }
        setTimeout(() => {
            if (this.elevenLabsWs) this.elevenLabsWs.close();
            processCallOutcome(this.chatHistory, this.streamSid, this.leadData);
        }, 1000);
    }

    startSilenceTimeout() {
        this.clearSilenceTimeout();
        this.silenceTimeout = setTimeout(() => {
            console.log(`[${this.streamSid}] Silence detected`);
            this.processWithLLM("*Silence detected for 10 seconds. Prompt the user to see if they are still there.*");
        }, 12000);
    }

    clearSilenceTimeout() {
        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
        }
    }
}
