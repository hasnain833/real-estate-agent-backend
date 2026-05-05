import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import Agent from '../../models/Agent.js';
import 'dotenv/config'; // Ensure env is loaded in this module scope

// SMTP Setup for Brevo
const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_KEY,
    },
    family: 4, // Force IPv4
    tls: {
        rejectUnauthorized: false
    }
});

// Generate JWT Token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'supersecretkey', {
        expiresIn: '1h',
    });
};

// Send OTP via SMTP
const sendOTPEmail = async (email, otp) => {
    const mailOptions = {
        from: `"AI Agent Pro" <${process.env.BREVO_FROM_EMAIL}>`,
        to: email,
        subject: `${otp} is your verification code`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); }
                .header { background-color: #0f172a; padding: 40px 20px; text-align: center; color: #ffffff; }
                .header h1 { margin: 0; font-size: 24px; letter-spacing: -0.5px; }
                .content { padding: 40px 30px; text-align: center; color: #334155; }
                .otp-code { font-size: 48px; font-weight: 800; color: #3b82f6; letter-spacing: 10px; margin: 30px 0; padding: 20px; background-color: #eff6ff; border-radius: 8px; display: inline-block; width: 80%; }
                .footer { background-color: #f8fafc; padding: 20px; text-align: center; color: #94a3b8; font-size: 12px; }
                .warning { font-size: 14px; color: #64748b; margin-top: 20px; line-height: 1.6; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>AI Agent Pro</h1>
                </div>
                <div class="content">
                    <h2 style="margin-top: 0;">Verify Your Email</h2>
                    <p>Welcome to the future of real estate automation. Use the code below to complete your registration.</p>
                    <div class="otp-code">${otp}</div>
                    <p class="warning">
                        This code is valid for <strong>5 minutes</strong>.<br>
                        If you did not request this email, please ignore it or contact support.
                    </p>
                </div>
                <div class="footer">
                    &copy; ${new Date().getFullYear()} AI Agent Pro. All rights reserved.<br>
                    Real Estate Automation Platform
                </div>
            </div>
        </body>
        </html>
        `,
    };

    return await transporter.sendMail(mailOptions);
};

export const registerAgent = async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        // Password Validation: 8+ chars, 1 capital, 1 special
        const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*])(?=.{8,})/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters, include one capital letter and one special character.' });
        }

        const agentExists = await Agent.findOne({ email });
        if (agentExists) {
            return res.status(400).json({ error: 'Agent with this email already exists' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Send Email
        await sendOTPEmail(email, otp);

        // Create a stateless pending token containing the data and OTP
        const pendingToken = jwt.sign(
            { name, email, password, otp },
            process.env.JWT_SECRET || 'supersecretkey',
            { expiresIn: '5m' }
        );

        res.status(200).json({
            message: 'OTP sent to your email. Please verify to complete registration.',
            pendingToken,
            email
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const verifyOTP = async (req, res) => {
    try {
        const { otp, pendingToken } = req.body;

        if (!pendingToken) {
            return res.status(400).json({ error: 'No pending registration found' });
        }

        // Verify the pending token
        let decoded;
        try {
            decoded = jwt.verify(pendingToken, process.env.JWT_SECRET || 'supersecretkey');
        } catch (err) {
            return res.status(400).json({ error: 'Verification session expired. Please sign up again.' });
        }

        // Check OTP
        if (decoded.otp !== otp) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        // OTP is correct, now create the agent in the database
        const agent = await Agent.create({
            name: decoded.name,
            email: decoded.email,
            password: decoded.password,
            isVerified: true
        });

        res.status(201).json({
            message: 'Account created successfully',
            data: {
                _id: agent._id,
                name: agent.name,
                email: agent.email,
                token: generateToken(agent._id)
            }
        });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const loginAgent = async (req, res) => {
    try {
        const { email, password } = req.body;

        const agent = await Agent.findOne({ email });

        if (!agent || !(await agent.comparePassword(password))) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!agent.isVerified) {
            return res.status(401).json({ error: 'Please verify your email before logging in' });
        }

        res.status(200).json({
            message: 'Login successful',
            data: {
                _id: agent._id,
                name: agent.name,
                email: agent.email,
                token: generateToken(agent._id)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
