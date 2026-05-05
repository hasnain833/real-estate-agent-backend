import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema({
    agent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Agent',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Completed', 'Busy', 'Failed', 'Interested', 'Not Interested'],
        default: 'Pending'
    },
    duration: {
        type: Number, // in seconds
        default: 0
    },
    transcript: {
        type: String,
        default: ''
    },
    summary: {
        type: String,
        default: ''
    },
    callSid: {
        type: String // Twilio Call SID
    }
}, { timestamps: true });

const Lead = mongoose.model('Lead', leadSchema);
export default Lead;
