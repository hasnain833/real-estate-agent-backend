import express from 'express';
import { inboundCall } from './inbound.controller.js';
import twilio from 'twilio';

const router = express.Router();

router.post('/', twilio.webhook({ validate: process.env.NODE_ENV === 'production' }), inboundCall);

export default router;