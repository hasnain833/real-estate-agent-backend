import express from 'express';
import { registerAgent, loginAgent, verifyOTP } from './auth.controller.js';
import { protect } from '../../middleware/authMiddleware.js';

const router = express.Router();

// Auth routes
router.post('/register', registerAgent);
router.post('/login', loginAgent);
router.post('/verify-otp', verifyOTP);

// Protected routes
router.get('/me', protect, (req, res) => {
    res.status(200).json({ data: req.agent });
});

export default router;