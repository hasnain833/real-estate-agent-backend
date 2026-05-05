import jwt from 'jsonwebtoken';
import Agent from '../models/Agent.js';

export const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Get token from header
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey');

            // Get user from the token
            req.agent = await Agent.findById(decoded.id).select('-password');

            if (!req.agent) {
                return res.status(401).json({ error: 'Not authorized, agent not found' });
            }

            next();
        } catch (error) {
            console.error(error);
            res.status(401).json({ error: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        res.status(401).json({ error: 'Not authorized, no token' });
    }
};
