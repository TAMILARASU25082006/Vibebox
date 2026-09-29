const mongoose = require('mongoose');

const SongSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  title: { type: String, default: 'Unknown Title' },
  artist: { type: String, default: 'Unknown Artist' },
  thumbnail: { type: String, default: '' },
  duration: { type: String, default: '0:00' }
});

const CommentSchema = new mongoose.Schema({
  username: { type: String, required: true },
  text: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});

const SharedPlaylistSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  createdBy: { type: String, required: true },
  songs: [SongSchema],
  likes: { type: [String], default: [] }, // Stores usernames of users who liked it
  comments: [CommentSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('SharedPlaylist', SharedPlaylistSchema);
