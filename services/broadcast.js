import { WebSocket } from 'ws';

class BroadcastService {
    constructor() {
        this.clients = new Set();
        this.activeCalls = new Map(); // Store current state of all active calls
    }

    addClient(ws) {
        this.clients.add(ws);
        console.log(`Dashboard client connected. Total clients: ${this.clients.size}`);
        
        // Sync existing active calls to the new client
        if (this.activeCalls.size > 0) {
            console.log(`Syncing ${this.activeCalls.size} active calls to new client`);
            this.activeCalls.forEach((callData, streamSid) => {
                ws.send(JSON.stringify({ 
                    event: 'CALL_STATUS', 
                    data: { streamSid, ...callData, status: 'In Progress' } 
                }));
                
                // Also send historical transcripts if we have them
                if (callData.transcripts && callData.transcripts.length > 0) {
                    callData.transcripts.forEach(t => {
                        ws.send(JSON.stringify({
                            event: t.role === 'user' ? 'USER_TRANSCRIPT' : 'AGENT_TRANSCRIPT',
                            data: { streamSid, text: t.text, isFinal: true }
                        }));
                    });
                }
            });
        }
        
        ws.on('close', () => {
            this.clients.delete(ws);
            console.log(`Dashboard client disconnected. Total clients: ${this.clients.size}`);
        });
    }

    broadcast(event, data) {
        // Update internal state
        const sid = data.streamSid;
        if (event === 'CALL_STATUS') {
            if (data.status === 'Ended') {
                this.activeCalls.delete(sid);
            } else {
                this.activeCalls.set(sid, { 
                    leadData: data.leadData, 
                    transcripts: [],
                    startTime: Date.now() 
                });
            }
        } else if (event === 'USER_TRANSCRIPT' || event === 'AGENT_TRANSCRIPT') {
            const call = this.activeCalls.get(sid);
            if (call && (event === 'AGENT_TRANSCRIPT' || data.isFinal)) {
                call.transcripts.push({ 
                    role: event === 'USER_TRANSCRIPT' ? 'user' : 'agent', 
                    text: data.text 
                });
            }
        }

        const payload = JSON.stringify({ event, data });
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }
}

export const broadcastService = new BroadcastService();
