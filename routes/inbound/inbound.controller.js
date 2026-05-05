import dotenv from 'dotenv';

dotenv.config();

export const inboundCall = (req, res) => {
    try {
        console.log('Incoming call received');
        const queryParams = new URLSearchParams(req.query).toString();
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
        
        const streamUrl = `${protocol}://${host}/stream`;
        console.log(`Twilio Stream URL: ${streamUrl}`);
        
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Say>Connecting to the AI agent.</Say>
            <Connect>
                <Stream url="${streamUrl}">
                    <Parameter name="name" value="${req.query.name || ''}" />
                    <Parameter name="phone" value="${req.query.phone || ''}" />
                    <Parameter name="property" value="${req.query.property || ''}" />
                    <Parameter name="budget" value="${req.query.budget || ''}" />
                    <Parameter name="agentId" value="${req.query.agentId || ''}" />
                </Stream>
            </Connect>
        </Response>`;

        res.type('text/xml');
        res.send(twimlResponse);
    } catch (error) {
        console.error('Error handling inbound call:', error);
        res.status(500).send('Internal Server Error');
    }
}