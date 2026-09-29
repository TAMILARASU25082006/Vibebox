const express = require('express');
const cors = require('cors');
const compression = require('compression');
const https = require('https');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client();

// Load Mongoose models
const User = require('./models/user');
const SharedPlaylist = require('./models/playlist');
const Lyric = require('./models/lyric');
const Room = require('./models/room');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vibebox:Open123@vibebox.mazprns.mongodb.net/?appName=vibebox';
const JWT_SECRET = process.env.JWT_SECRET || 'vibebox_jwt_secret_2026_super_secure';

// Connect to MongoDB Database
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB successfully connected!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Enable middleware
app.use(cors());
app.use(compression());
app.use(express.json()); // Enable JSON body parsing
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
}

// YouTube Search Scraper helper
function scrapeYouTubeSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };

    https.get(url, options, (res) => {
      let html = '';
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', () => {
        try {
          const regex = /ytInitialData\s*=\s*({.+?});/s;
          const match = html.match(regex);
          if (!match) {
            return reject(new Error('Could not find ytInitialData in response.'));
          }

          const json = JSON.parse(match[1]);
          const contents = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
          
          const results = [];
          for (const item of contents) {
            if (item.videoRenderer) {
              const video = item.videoRenderer;
              const videoId = video.videoId;
              if (!videoId) continue;
              
              const title = video.title && video.title.runs && video.title.runs[0] 
                ? video.title.runs[0].text 
                : (video.title ? video.title.simpleText : 'Unknown Title');
              
              const artist = video.ownerText && video.ownerText.runs && video.ownerText.runs[0]
                ? video.ownerText.runs[0].text
                : 'Unknown Artist';
              
              const thumbnail = video.thumbnail && video.thumbnail.thumbnails && video.thumbnail.thumbnails[0]
                ? video.thumbnail.thumbnails[0].url
                : 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300';
              
              let duration = '0:00';
              if (video.lengthText) {
                duration = video.lengthText.simpleText || (video.lengthText.runs && video.lengthText.runs[0] ? video.lengthText.runs[0].text : '0:00');
              }
              
              results.push({
                videoId,
                title,
                artist,
                thumbnail,
                duration
              });
            }
          }
          resolve(results);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// --- API ENDPOINTS ---

// Search endpoint
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const results = await scrapeYouTubeSearch(query);
    res.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to search YouTube.', details: err.message });
  }
});

// Auto-suggestions proxy endpoint
app.get('/api/suggest', (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.json({ suggestions: [] });
  }

  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`;
  
  https.get(url, (googleRes) => {
    let rawData = '';
    googleRes.on('data', (chunk) => { rawData += chunk; });
    googleRes.on('end', () => {
      try {
        const parsed = JSON.parse(rawData);
        const suggestions = parsed[1] || [];
        res.json({ suggestions });
      } catch (err) {
        res.json({ suggestions: [] });
      }
    });
  }).on('error', () => {
    res.json({ suggestions: [] });
  });
});

// --- AUTHENTICATION ENDPOINTS ---

// User Registration
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
  }
  
  try {
    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username: username.toLowerCase(),
      password: hashedPassword,
      library: {
        likedSongs: [],
        playlists: [],
        recentlyPlayed: [],
        settings: { theme: 'green', showVideo: true, quality: 'highres' }
      }
    });
    
    await newUser.save();
    
    const token = jwt.sign({ id: newUser._id, username: newUser.username }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, username: newUser.username, library: newUser.library });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  
  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }
    
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, avatar: user.avatar || '', library: user.library });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Google OAuth Login / Registration
app.post('/api/auth/google', async (req, res) => {
  const { credential, clientId } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Google ID token credential is required.' });
  }

  try {
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: clientId || undefined
      });
      payload = ticket.getPayload();
    } catch (e) {
      // Fallback: verify via Google tokeninfo HTTP endpoint if library audience check requires explicit client_id
      const fetchRes = await new Promise((resolve) => {
        https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, (gRes) => {
          let body = '';
          gRes.on('data', chunk => { body += chunk; });
          gRes.on('end', () => resolve({ status: gRes.statusCode, body }));
        }).on('error', () => resolve({ status: 500, body: '{}' }));
      });
      
      if (fetchRes.status === 200) {
        payload = JSON.parse(fetchRes.body);
      } else {
        throw e;
      }
    }

    if (!payload || (!payload.sub && !payload.email)) {
      return res.status(400).json({ error: 'Invalid Google credential token payload.' });
    }

    const googleId = payload.sub;
    const email = payload.email ? payload.email.toLowerCase() : '';
    const name = payload.name || payload.given_name || (email ? email.split('@')[0] : 'User');
    const avatar = payload.picture || '';

    // Find existing user by googleId, email, or username
    let user = await User.findOne({
      $or: [
        { googleId: googleId },
        ...(email ? [{ email: email }] : []),
        { username: name.toLowerCase().replace(/\s+/g, '_') }
      ]
    });

    if (!user) {
      let username = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 20);
      if (username.length < 3) username = `user_${Math.floor(1000 + Math.random() * 9000)}`;
      
      let existingUsername = await User.findOne({ username });
      if (existingUsername) {
        username = `${username.substring(0, 14)}_${Math.floor(100 + Math.random() * 900)}`;
      }

      user = new User({
        username,
        googleId,
        email,
        avatar,
        library: {
          likedSongs: [],
          playlists: [],
          recentlyPlayed: [],
          settings: { theme: 'green', showVideo: true, quality: 'highres' }
        }
      });
      await user.save();
    } else {
      let modified = false;
      if (!user.googleId) { user.googleId = googleId; modified = true; }
      if (!user.email && email) { user.email = email; modified = true; }
      if (avatar && user.avatar !== avatar) { user.avatar = avatar; modified = true; }
      if (modified) await user.save();
    }

    const token = jwt.sign({ id: user._id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, email: user.email, avatar: user.avatar, library: user.library });
  } catch (err) {
    console.error('Google OAuth Login error:', err);
    res.status(400).json({ error: 'Failed to authenticate with Google: ' + err.message });
  }
});

// --- LIBRARY / CLOUD SYNC ENDPOINTS ---

app.get('/api/library', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ library: user.library });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch library.' });
  }
});

app.post('/api/library/sync', authenticateToken, async (req, res) => {
  const { library } = req.body;
  if (!library) {
    return res.status(400).json({ error: 'Library payload is required.' });
  }
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    
    user.library = {
      likedSongs: library.likedSongs || [],
      playlists: library.playlists || [],
      recentlyPlayed: library.recentlyPlayed || [],
      settings: library.settings || user.library.settings
    };
    
    await user.save();
    res.json({ success: true, library: user.library });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Failed to sync library.' });
  }
});

// --- COMMUNITY / DYNAMIC PLAYLIST ENDPOINTS ---

app.get('/api/playlists/public', async (req, res) => {
  try {
    const playlists = await SharedPlaylist.find().sort({ createdAt: -1 });
    res.json({ playlists });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch public playlists.' });
  }
});

app.post('/api/playlists/share', authenticateToken, async (req, res) => {
  const { title, description, songs } = req.body;
  if (!title || !songs) {
    return res.status(400).json({ error: 'Title and songs are required.' });
  }
  
  try {
    let playlist = await SharedPlaylist.findOne({ title, createdBy: req.user.username });
    if (playlist) {
      playlist.description = description || playlist.description;
      playlist.songs = songs;
      await playlist.save();
    } else {
      playlist = new SharedPlaylist({
        title,
        description: description || '',
        createdBy: req.user.username,
        songs,
        likes: [],
        comments: []
      });
      await playlist.save();
    }
    res.status(201).json({ success: true, playlist });
  } catch (err) {
    console.error('Playlist share error:', err);
    res.status(500).json({ error: 'Failed to share playlist.' });
  }
});

app.post('/api/playlists/like', authenticateToken, async (req, res) => {
  const { playlistId } = req.body;
  if (!playlistId) return res.status(400).json({ error: 'Playlist ID is required.' });
  
  try {
    const playlist = await SharedPlaylist.findById(playlistId);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
    
    const index = playlist.likes.indexOf(req.user.username);
    if (index === -1) {
      playlist.likes.push(req.user.username);
    } else {
      playlist.likes.splice(index, 1);
    }
    
    await playlist.save();
    res.json({ success: true, likes: playlist.likes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle like.' });
  }
});

app.post('/api/playlists/:id/comment', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Comment text is required.' });
  }
  
  try {
    const playlist = await SharedPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
    
    const newComment = {
      username: req.user.username,
      text: text.trim(),
      createdAt: new Date()
    };
    playlist.comments.push(newComment);
    await playlist.save();
    
    res.status(201).json({ success: true, comment: newComment });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment.' });
  }
});

// --- LYRICS ENDPOINTS ---

app.get('/api/lyrics', async (req, res) => {
  const { artist, title } = req.query;
  if (!artist || !title) {
    return res.status(400).json({ error: 'Artist and title parameters are required.' });
  }
  
  const songKey = `${artist.trim()} - ${title.trim()}`.toLowerCase();
  
  try {
    // 1. Check DB first
    let lyricEntry = await Lyric.findOne({ songKey });
    if (lyricEntry) {
      return res.json({ lyrics: lyricEntry.lyrics });
    }
    
    // 2. Query free API (lyrics.ovh)
    const cleanArtist = encodeURIComponent(artist.trim());
    const cleanTitle = encodeURIComponent(title.trim());
    const url = `https://api.lyrics.ovh/v1/${cleanArtist}/${cleanTitle}`;
    
    https.get(url, (apiRes) => {
      let rawData = '';
      apiRes.on('data', (chunk) => { rawData += chunk; });
      apiRes.on('end', async () => {
        try {
          const parsed = JSON.parse(rawData);
          if (parsed.lyrics) {
            lyricEntry = new Lyric({ songKey, lyrics: parsed.lyrics });
            await lyricEntry.save();
            return res.json({ lyrics: parsed.lyrics });
          } else {
            res.json({ lyrics: null });
          }
        } catch (err) {
          res.json({ lyrics: null });
        }
      });
    }).on('error', () => {
      res.json({ lyrics: null });
    });
    
  } catch (err) {
    console.error('Lyrics fetch error:', err);
    res.json({ lyrics: null });
  }
});

app.post('/api/lyrics/submit', authenticateToken, async (req, res) => {
  const { artist, title, lyrics } = req.body;
  if (!artist || !title || !lyrics || !lyrics.trim()) {
    return res.status(400).json({ error: 'Artist, title, and lyrics are required.' });
  }
  
  const songKey = `${artist.trim()} - ${title.trim()}`.toLowerCase();
  
  try {
    let lyricEntry = await Lyric.findOne({ songKey });
    if (lyricEntry) {
      lyricEntry.lyrics = lyrics.trim();
      await lyricEntry.save();
    } else {
      lyricEntry = new Lyric({ songKey, lyrics: lyrics.trim() });
      await lyricEntry.save();
    }
    res.json({ success: true, lyrics: lyricEntry.lyrics });
  } catch (err) {
    console.error('Lyrics save error:', err);
    res.status(500).json({ error: 'Failed to save lyrics.' });
  }
});

// --- SMART AI TRACK RADIO & MOOD MIX ENDPOINTS ---

app.get('/api/radio', async (req, res) => {
  const { title, artist, mood } = req.query;
  let searchQuery = 'chill music mix';
  
  if (mood) {
    const moodQueries = {
      chill: 'lofi chill beats relaxing instrumental playlist',
      workout: 'high energy workout motivational gym music',
      focus: 'deep focus study ambient background music',
      retro: '80s synthwave retrowave synth pop hits',
      party: 'club party dance hits EDM remix'
    };
    searchQuery = moodQueries[mood] || 'trending music mix';
  } else if (artist || title) {
    const cleanArtist = artist ? artist.replace(/\b(Official|Video|Audio|Topic|VEVO|HD)\b/gi, '').trim() : '';
    const cleanTitle = title ? title.replace(/\(.*?\)|\[.*?\]/g, '').trim() : '';
    searchQuery = `${cleanArtist} ${cleanTitle} similar audio music tracks mix`.trim();
  }

  try {
    const results = await scrapeYouTubeSearch(searchQuery);
    res.json({ success: true, query: searchQuery, results: results.slice(0, 15) });
  } catch (err) {
    console.error('Radio endpoint error:', err);
    res.status(500).json({ error: 'Failed to generate radio mix.' });
  }
});

// --- COLLABORATIVE PLAYLISTS ENDPOINTS ---

app.post('/api/playlists/:id/collaborate', authenticateToken, async (req, res) => {
  try {
    const playlist = await SharedPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
    if (playlist.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Only the playlist creator can enable collaboration.' });
    }

    if (!playlist.isCollaborative) {
      playlist.isCollaborative = true;
      playlist.collabCode = 'COL-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      if (!playlist.collaborators.includes(req.user.username)) {
        playlist.collaborators.push(req.user.username);
      }
      await playlist.save();
    }

    res.json({ success: true, collabCode: playlist.collabCode, isCollaborative: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to enable collaboration.' });
  }
});

app.post('/api/playlists/join-collab', authenticateToken, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Collab code is required.' });

  try {
    const playlist = await SharedPlaylist.findOne({ collabCode: code.toUpperCase().trim() });
    if (!playlist) return res.status(404).json({ error: 'Invalid collaboration code.' });

    if (!playlist.collaborators.includes(req.user.username)) {
      playlist.collaborators.push(req.user.username);
      await playlist.save();
    }

    res.json({ success: true, playlist });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join collaborative playlist.' });
  }
});

app.post('/api/playlists/:id/add-track', authenticateToken, async (req, res) => {
  const { song } = req.body;
  if (!song || !song.videoId) return res.status(400).json({ error: 'Song object with videoId is required.' });

  try {
    const playlist = await SharedPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

    const isCreator = playlist.createdBy === req.user.username;
    const isCollab = playlist.isCollaborative && playlist.collaborators.includes(req.user.username);

    if (!isCreator && !isCollab) {
      return res.status(403).json({ error: 'You do not have permission to edit this playlist.' });
    }

    // Check duplicate
    if (!playlist.songs.some(s => s.videoId === song.videoId)) {
      playlist.songs.push(song);
      await playlist.save();
    }

    res.json({ success: true, playlist });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add track.' });
  }
});

app.post('/api/playlists/:id/remove-track', authenticateToken, async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId is required.' });

  try {
    const playlist = await SharedPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

    const isCreator = playlist.createdBy === req.user.username;
    const isCollab = playlist.isCollaborative && playlist.collaborators.includes(req.user.username);

    if (!isCreator && !isCollab) {
      return res.status(403).json({ error: 'You do not have permission to edit this playlist.' });
    }

    playlist.songs = playlist.songs.filter(s => s.videoId !== videoId);
    await playlist.save();

    res.json({ success: true, playlist });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove track.' });
  }
});

// --- LIVE "LISTEN TOGETHER" ROOMS ENDPOINTS ---

app.post('/api/rooms/create', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name is required.' });

  try {
    const code = 'VB-' + Math.floor(100000 + Math.random() * 900000);
    const room = new Room({
      code,
      name: name.trim(),
      host: req.user.username,
      listeners: [{ username: req.user.username }]
    });

    await room.save();
    res.status(201).json({ success: true, room });
  } catch (err) {
    console.error('Room create error:', err);
    res.status(500).json({ error: 'Failed to create room.' });
  }
});

app.post('/api/rooms/join', authenticateToken, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Room code is required.' });

  try {
    const room = await Room.findOne({ code: code.toUpperCase().trim() });
    if (!room) return res.status(404).json({ error: 'Room not found.' });

    if (!room.listeners.some(l => l.username === req.user.username)) {
      room.listeners.push({ username: req.user.username });
      await room.save();
    }

    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join room.' });
  }
});

app.get('/api/rooms/:code/state', async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch room state.' });
  }
});

app.post('/api/rooms/:code/sync', authenticateToken, async (req, res) => {
  const { currentTrack, currentTime, isPlaying, queue } = req.body;

  try {
    const room = await Room.findOne({ code: req.params.code.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found.' });

    if (room.host !== req.user.username) {
      return res.status(403).json({ error: 'Only the room host can sync playback state.' });
    }

    if (currentTrack !== undefined) room.currentTrack = currentTrack;
    if (currentTime !== undefined) room.currentTime = currentTime;
    if (isPlaying !== undefined) room.isPlaying = isPlaying;
    if (queue !== undefined) room.queue = queue;

    await room.save();
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sync room state.' });
  }
});

app.post('/api/rooms/:code/chat', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required.' });

  try {
    const room = await Room.findOne({ code: req.params.code.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found.' });

    const message = { username: req.user.username, text: text.trim(), timestamp: new Date() };
    room.messages.push(message);

    // Keep max 50 recent messages
    if (room.messages.length > 50) {
      room.messages = room.messages.slice(-50);
    }

    await room.save();
    res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: 'Failed to post chat message.' });
  }
});

// Serve frontend SPA fallback (for local SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`VibeBox Server is running at http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop the server.`);
    console.log(`=================================================`);
  });
}

module.exports = app;
