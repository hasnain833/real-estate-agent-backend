import { google } from 'googleapis';
import Agent from '../../models/Agent.js';

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

export const getAuthUrl = async (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        state: req.agent._id.toString(), // Pass agent ID to state to retrieve it in callback
        prompt: 'consent'
    });

    res.status(200).json({ url });
};

export const googleCallback = async (req, res) => {
    const { code, state } = req.query;

    try {
        const { tokens } = await oauth2Client.getToken(code);
        
        // Find agent by ID passed in state
        const agent = await Agent.findById(state);
        if (!agent) {
            return res.status(404).send('Agent not found');
        }

        // Save tokens
        agent.googleAccessToken = tokens.access_token;
        if (tokens.refresh_token) {
            agent.googleRefreshToken = tokens.refresh_token;
        }
        agent.googleCalendarId = 'primary';
        await agent.save();

        // Redirect back to frontend appointments page with success
        res.redirect(`${process.env.FRONTEND_URL}/appointments?success=true`);
    } catch (error) {
        console.error('Google Auth Error:', error);
        res.redirect(`${process.env.FRONTEND_URL}/appointments?error=auth_failed`);
    }
};

export const getCalendarStatus = async (req, res) => {
    try {
        const agent = await Agent.findById(req.agent._id);
        res.status(200).json({ 
            isConnected: !!agent.googleRefreshToken,
            calendarId: agent.googleCalendarId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const disconnectCalendar = async (req, res) => {
    try {
        const agent = await Agent.findById(req.agent._id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        agent.googleAccessToken = null;
        agent.googleRefreshToken = null;
        agent.googleCalendarId = null;
        await agent.save();

        res.status(200).json({ message: 'Calendar disconnected successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
