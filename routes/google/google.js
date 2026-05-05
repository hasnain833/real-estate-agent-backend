import express from 'express';
import { getAuthUrl, googleCallback, getCalendarStatus, disconnectCalendar } from './google.controller.js';
import { protect } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/auth-url', protect, getAuthUrl);
router.get('/callback', googleCallback);
router.get('/status', protect, getCalendarStatus);
router.post('/disconnect', protect, disconnectCalendar);

export default router;
