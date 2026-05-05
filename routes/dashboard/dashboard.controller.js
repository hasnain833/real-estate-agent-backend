import Lead from '../../models/Lead.js';
import Call from '../../models/Call.js';
export const getDashboardStats = async (req, res) => {
    try {
        const agentId = req.agent._id;

        // Fetch all leads and calls for this agent
        const [leads, calls] = await Promise.all([
            Lead.find({ agent: agentId }).sort({ createdAt: -1 }),
            Call.find({ agentId: agentId }).sort({ createdAt: -1 }).limit(20)
        ]);

        // Calculate stats (using both models)
        const totalCalls = calls.length || leads.length;
        const totalMinutes = Math.round(calls.reduce((acc, c) => acc + (c.duration || 0), 0) / 60);
        
        const interestedLeads = leads.filter(l => l.status === 'Interested').length;
        const conversionRate = totalCalls > 0 ? Math.round((interestedLeads / totalCalls) * 100) : 0;

        // Recent activity (prioritize calls because they have transcripts)
        const recentActivity = calls.slice(0, 5).map(c => ({
            id: c._id,
            name: c.leadName || 'Inbound Call',
            phone: c.phoneNumber,
            status: c.status,
            time: c.createdAt
        }));

        // Calculate daily stats for the last 7 days
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
            
            const dayLeads = leads.filter(l => {
                const leadDate = new Date(l.createdAt);
                return leadDate.toDateString() === date.toDateString();
            });

            last7Days.push({
                name: dayName,
                calls: dayLeads.length,
                minutes: Math.round(dayLeads.reduce((acc, l) => acc + (l.duration || 0), 0) / 60)
            });
        }

        // Sentiment/Status distribution
        const sentimentData = [
            { name: 'Interested', value: leads.filter(l => l.status === 'Interested').length, color: '#22c55e' },
            { name: 'Neutral', value: leads.filter(l => l.status === 'Completed').length, color: '#3b82f6' },
            { name: 'Failed', value: leads.filter(l => l.status === 'Failed').length, color: '#ef4444' },
        ];

        res.status(200).json({
            stats: {
                totalCalls,
                totalMinutes,
                conversionRate,
                activeLeads: interestedLeads
            },
            recentActivity,
            dailyStats: last7Days,
            sentimentData
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
};
