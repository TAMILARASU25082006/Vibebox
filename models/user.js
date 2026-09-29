const mongoose = require('mongoose');

const SongSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  title: { type: String, default: 'Unknown Title' },
  artist: { type: String, default: 'Unknown Artist' },
  thumbnail: { type: String, default: '' },
  duration: { type: String, default: '0:00' }
});

const PlaylistSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Local front-end client reference
  name: { type: String, required: true },
  description: { type: String, default: '' },
  songs: [SongSchema]
});

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 20
  },
  password: {
    type: String,
    required: false
  },
  googleId: {
    type: String,
    sparse: true
  },
  email: {
    type: String,
    default: ''
  },
  avatar: {
    type: String,
    default: ''
  },
  library: {
    likedSongs: { type: [SongSchema], default: [] },
    playlists: { type: [PlaylistSchema], default: [] },
    recentlyPlayed: { type: [SongSchema], default: [] },
    settings: {
      theme: { type: String, default: 'green' },
      showVideo: { type: Boolean, default: true },
      quality: { type: String, default: 'highres' }
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', UserSchema);
