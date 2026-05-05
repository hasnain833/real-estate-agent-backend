import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const logSystemEvent = (eventType, details) => {
    try {
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }
        const logPath = path.join(logDir, 'app.log');
        const logEntry = `[${new Date().toISOString()}] [${eventType}] ${JSON.stringify(details)}\n`;
        fs.appendFileSync(logPath, logEntry);
    } catch (err) {
        console.error('Failed to write to persistent log:', err);
    }
};

export const processCallOutcome = async (chatHistory, streamSid, leadData) => {
    try {
        const isOutbound = leadData && leadData.name;
        
        // 1. Extract the OUTCOME blocks from the final assistant message
        let outcome = 'unknown';
        let appointmentDetails = 'none';
        let leadDataParts = [];

        for (let i = chatHistory.length - 1; i >= 0; i--) {
            const msg = chatHistory[i];
            if (msg.role === 'assistant') {
                const outMatch = msg.content.match(/\[OUTCOME:\s*(.*?)\]/i);
                if (outMatch) outcome = outMatch[1].trim();

                const apptMatch = msg.content.match(/\[APPOINTMENT:\s*(.*?)\]/i);
                if (apptMatch) appointmentDetails = apptMatch[1].trim();

                const leadMatch = msg.content.match(/\[LEAD_DATA:\s*(.*?)\]/i);
                if (leadMatch) {
                    leadDataParts = leadMatch[1].split('|').map(p => p.trim());
                }

                if (outMatch || apptMatch || leadMatch) break;
            }
        }
        
        const name = leadDataParts[0] || (isOutbound ? leadData.name : 'Unknown');
        const email = leadDataParts[1] || 'unknown';
        const phone = leadDataParts[2] || 'unknown';
        const budget = leadDataParts[3] || 'unknown';
        const timeline = leadDataParts[4] || 'unknown';
        const propertyInfo = leadDataParts[5] || 'unknown';
        const preApproved = leadDataParts[6] === 'true' || leadDataParts[6] === 'yes' || leadDataParts[6] === '1';

        // Fallback: if OUTCOME block could not be parsed, notify Slack for manual review
        if (outcome === 'unknown') {
            console.warn(`[PARSE FAILURE] No OUTCOME block found for stream ${streamSid}. Logging raw transcript for manual review.`);
            logSystemEvent('OUTCOME_PARSE_FAILURE', { streamSid });
            const webhookUrl = process.env.SLACK_WEBHOOK_URL;
            if (webhookUrl) {
                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: `⚠️ *OUTCOME Parse Failure* — Stream \`${streamSid}\` ended with no parseable OUTCOME block. Manual review required.\n\`\`\`${chatHistory.slice(-3).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}\`\`\``
                    })
                }).catch(e => console.error('Slack fallback error:', e));
            }
        }
        
        const logData = {
            callSid: streamSid,
            timestamp: new Date().toISOString(),
            direction: isOutbound ? 'outbound' : 'inbound',
            duration: 'N/A', // Duration would be calculated if we tracked start/end time
            outcome: outcome,
            leadName: name,
            email: email,
            phone: phone,
            budget: budget,
            timeline: timeline,
            preApproved: preApproved,
            property: propertyInfo,
            appointmentDetails: appointmentDetails,
            transcript: fullTranscript
        };

        console.log('--- CALL OUTCOME PROCESSED ---');
        console.log(logData);

        // 2. Log to Google Sheets (FR-LOG-02)
        await logToGoogleSheets(logData);

        // 3. Send Slack Notification (FR-LOG-04)
        if (outcome === 'hot_lead' || appointmentDetails !== 'none' || outcome.includes('appointment_booked')) {
            await sendSlackNotification(logData, leadData);
        }

    } catch (error) {
        console.error('Error processing call outcome:', error);
    }
};

const logToGoogleSheets = async (data) => {
    try {
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const credentialsStr = process.env.GOOGLE_CREDENTIALS; // e.g. JSON string of service account
        
        if (!spreadsheetId || !credentialsStr) {
            console.log('Skipping Google Sheets logging (Missing GOOGLE_SHEET_ID or GOOGLE_CREDENTIALS)');
            return;
        }

        const credentials = JSON.parse(credentialsStr);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        
        const values = [
            [
                data.timestamp,
                data.callSid,
                data.direction,
                data.duration,
                data.outcome,
                data.leadName,
                data.email,
                data.phone,
                data.budget,
                data.timeline,
                data.preApproved,
                data.property,
                data.appointmentDetails,
                data.transcript
            ]
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Sheet1!A:N', // 14 columns
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        console.log('Successfully logged to Google Sheets');
    } catch (error) {
        console.error('Google Sheets Error:', error);
    }
};

const sendSlackNotification = async (data, leadData) => {
    try {
        const webhookUrl = process.env.SLACK_WEBHOOK_URL;
        if (!webhookUrl) {
            console.log('Skipping Slack notification (Missing SLACK_WEBHOOK_URL)');
            return;
        }

        const property = leadData?.property || 'Unknown Property';

        const payload = {
            text: `🚨 *High Value Action Detected!* 🚨`,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Outcome:* ${data.outcome.toUpperCase()}\n*Name:* ${data.leadName}\n*Phone:* ${data.phone}\n*Email:* ${data.email}\n*Property:* ${property}\n*Appointment/Callback:* ${data.appointmentDetails}`
                    }
                }
            ]
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Slack API responded with ${response.status}`);
        }
        
        console.log('Successfully sent Slack notification');
    } catch (error) {
        console.error('Slack Notification Error:', error);
    }
};
