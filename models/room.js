const mongoose = require('mongoose');

const RoomSongSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  title: { type: String, default: 'Unknown Title' },
  artist: { type: String, default: 'Unknown Artist' },
  thumbnail: { type: String, default: '' },
  duration: { type: String, default: '0:00' }
});

const RoomChatMessageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const RoomSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  host: { type: String, required: true },
  currentTrack: RoomSongSchema,
  currentTime: { type: Number, default: 0 },
  isPlaying: { type: Boolean, default: false },
  queue: [RoomSongSchema],
  listeners: [{
    username: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now }
  }],
  messages: [RoomChatMessageSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Room', RoomSchema);
