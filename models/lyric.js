const mongoose = require('mongoose');

const LyricSchema = new mongoose.Schema({
  songKey: { type: String, required: true, unique: true }, // e.g., "artist_name - song_title" normalized
  lyrics: { type: String, required: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('Lyric', LyricSchema);
