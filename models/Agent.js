import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const agentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    googleAccessToken: {
        type: String,
        default: null
    },
    googleRefreshToken: {
        type: String,
        default: null
    },
    googleCalendarId: {
        type: String,
        default: null
    },
    otp: {
        type: String,
        default: null
    },
    otpExpires: {
        type: Date,
        default: null
    }
}, { timestamps: true });

// Hash password before saving
agentSchema.pre('save', async function() {
    if (!this.isModified('password')) return;
    
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
agentSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('Agent', agentSchema);
