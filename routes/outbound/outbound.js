import express from 'express';
import { outboundCall, endCall } from './outbound.controller.js';
import { protect } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', protect, outboundCall);
router.post('/end', protect, endCall);

export default router;