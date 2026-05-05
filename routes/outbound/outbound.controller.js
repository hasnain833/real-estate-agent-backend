import dotenv from 'dotenv';
import Lead from '../../models/Lead.js';
import twilio from 'twilio';

dotenv.config();

import { broadcastService } from '../../services/broadcast.js';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export const outboundCall = async (req, res) => {
    try {
        const { to, name, property, budget } = req.body;
        const agentId = req.agent._id; // Injected by protect middleware

        // Broadcast "Ringing" status immediately so UI shows the call
        broadcastService.broadcast('CALL_STATUS', {
            streamSid: `pending-${Date.now()}`,
            status: 'Ringing',
            leadData: { name, phone: to, property, budget, agentId }
        });

        if (!to) {
            return res.status(400).json({ error: 'Destination phone number is required' });
        }

        console.log(`Initiating outbound call to ${to} for agent ${agentId} via Twilio API...`);

        const pinggyUrl = req.body.pinggyUrl;
        const host = pinggyUrl ? new URL(pinggyUrl).host : req.headers.host;
        const queryParams = new URLSearchParams({
            name: name || '',
            phone: to || '',
            property: property || '',
            budget: budget || '',
            agentId: agentId.toString() // Pass agentId to stream
        }).toString();
        
        const inboundUrl = `https://${host}/outbound-start?${queryParams}`;
        console.log(`Twilio Callback URL: ${inboundUrl}`);
        console.log(`Request Host Header: ${req.headers.host}`);
        console.log(`Provided Pinggy URL: ${pinggyUrl || 'None'}`);
        // Call the Twilio API
        const call = await client.calls.create({
            url: inboundUrl,
            to: to,
            from: process.env.TWILIO_PHONE_NUMBER,
            machineDetection: 'Enable'
        });

        // Save the lead/call to DB
        await Lead.create({
            agent: agentId,
            name: name || 'Unknown',
            phoneNumber: to,
            status: 'Completed', // For now, we mark as completed once triggered
            callSid: call.sid
        });

        console.log('Outbound call triggered via Twilio & saved, SID:', call.sid);
        res.status(200).json({ message: 'Call initiated via Twilio API', sid: call.sid });
    } catch (error) {
        console.error('Error triggering outbound call via Twilio:', error);
        res.status(500).json({ error: 'Failed to initiate call via Twilio', details: error.message });
    }
};

export const endCall = async (req, res) => {
    try {
        const { callSid } = req.body;
        if (!callSid) return res.status(400).json({ error: 'Call SID is required' });

        console.log(`Manually terminating call: ${callSid}`);
        await client.calls(callSid).update({ status: 'completed' });
        
        res.status(200).json({ message: 'Call termination requested' });
    } catch (error) {
        console.error('Error terminating call:', error);
        res.status(500).json({ error: 'Failed to terminate call', details: error.message });
    }
};