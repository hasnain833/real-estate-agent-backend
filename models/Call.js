import mongoose from 'mongoose';

const callSchema = new mongoose.Schema({
    streamSid: {
        type: String,
        required: true,
        unique: true
    },
    agentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Agent',
        required: true
    },
    leadName: String,
    phoneNumber: String,
    property: String,
    budget: String,
    status: {
        type: String,
        enum: ['Calling', 'In Progress', 'Ended', 'Failed'],
        default: 'Calling'
    },
    transcripts: [{
        role: { type: String, enum: ['user', 'agent'] },
        text: String,
        timestamp: { type: Date, default: Date.now }
    }],
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    duration: Number
}, { timestamps: true });

const Call = mongoose.model('Call', callSchema);
export default Call;
