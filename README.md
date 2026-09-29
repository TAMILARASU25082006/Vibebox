# 🎵 VibeBox — Premium Personal Music Streaming Platform

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green?logo=node.js)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-v4.19-blue?logo=express)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose%20v9-brightgreen?logo=mongodb)](https://www.mongodb.com/)
[![Capacitor](https://img.shields.io/badge/Capacitor-v8-blueviolet?logo=capacitor)](https://capacitorjs.com/)
[![License](https://img.shields.io/badge/License-ISC-orange.svg)](LICENSE)

**VibeBox** is a feature-rich, high-performance personal music streaming web application and mobile app designed with a modern, glassmorphic UI inspired by Spotify and YouTube Music. Built with Node.js, Express, MongoDB, and Capacitor, VibeBox provides seamless audio streaming, playlist management, user library synchronization, synchronized lyrics, and cross-platform Android support.

---

## ✨ Key Features

- **🔍 Smart Music Search & Proxy Streaming**: Search millions of tracks with instant auto-suggestions and stream audio directly via YouTube scraping proxy.
- **🎛️ 10-Band Web Audio Equalizer & Dynamic Visualizer**:
  - Custom 10-band equalizer (32Hz - 16kHz) with Bass Boost and presets (Flat, Bass, Treble, Rock, EDM, Vocal, Acoustic).
  - Real-time HTML5 Canvas visualizers with 3 dynamic render modes: **Spectrum Bars**, **Waveform Line**, and **Neon Pulse Circle**.
- **🤖 Smart AI Track Radio & Auto-Play Recommendations**:
  - One-click **Track Radio** generator that crafts an endless, curated playlist based on track artist and style.
  - **Mood Radio Mixes** (`🌿 Chill Beats`, `⚡ Workout Energy`, `🎯 Deep Focus`, `🌃 80s Retro`, `🎉 Party Mix`).
  - **Endless Auto-Play Radio Mode**: Automatically queues similar tracks when your listening queue reaches the end.
- **👥 Live "Listen Together" Rooms & Collaborative Playlists**:
  - **Listen Together Rooms**: Host or join live rooms with custom room codes (`VB-XXXXXX`) to sync track playback, position, and live room chat in real-time.
  - **Collaborative Playlists**: Invite friends via collaboration codes to edit and add tracks to shared playlists.
- **📁 Local Audio Uploads & Offline Cache (IndexedDB)**:
  - Drag-and-drop or import local `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a` audio files.
  - Saved directly into browser IndexedDB storage for offline listening anywhere.
- **🔐 Dual Authentication**: Secure user login & registration using JWT tokens and bcrypt password hashing, plus **Google One-Tap / OAuth SSO**.
- **🎧 Personal Library & Cloud Sync**:
  - Liked Songs collection with instant toggle.
  - Custom user playlists (creation, editing, reordering, deletion).
  - Recently Played listening history & real-time cloud sync with MongoDB Atlas.
- **📜 Lyrics Integration**: Interactive synchronized and plain-text lyrics viewer for currently playing tracks.
- **📱 Cross-Platform Mobile Support**: Built-in Capacitor setup with automated PowerShell script (`build_local_apk.ps1`) to compile standalone Android APK binaries.
- **🚀 Cloud Deployment Ready**: Pre-configured with `vercel.json` for instant Vercel Serverless deployment.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, Vanilla CSS3 (Custom Glassmorphism & Tokens), JavaScript (ES6+) |
| **Backend** | Node.js, Express.js |
| **Database** | MongoDB & Mongoose ORM |
| **Auth** | JSON Web Tokens (JWT), `bcryptjs`, Google Auth Library (`google-auth-library`) |
| **Mobile Integration** | `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` |
| **Deployment** | Vercel Serverless, Node Environment |

---

## 📁 Project Architecture

```
vibebox/
├── models/                     # Mongoose Schema Models
│   ├── user.js                 # User profile, credentials & personal library schema
│   ├── playlist.js             # Public & shared playlist schema
│   └── lyric.js                # Cached lyrics schema
├── public/                     # Static Web Assets
│   ├── index.html              # Single Page Application container & HTML structure
│   ├── app.js                  # Frontend Application Logic, Audio Player, State & API Client
│   ├── style.css               # Design System, Glassmorphic CSS, Animations & Responsive Layout
│   ├── logo.png                # VibeBox Application Logo
│   ├── robots.txt              # SEO Crawler directive
│   ├── sitemap.xml             # Search Engine Sitemap
│   └── vibebox-app.apk         # Compiled Android APK binary (built via Capacitor)
├── server.js                   # Express Backend Server, API Routes, Auth & YouTube Scraper
├── build_local_apk.ps1         # Automated PowerShell script for local Android APK compilation
├── capacitor.config.json       # Capacitor Native Mobile App Configuration
├── vercel.json                 # Vercel Deployment & Route Rewrites Configuration
├── package.json                # Node.js project manifest & dependencies
└── README.md                   # Project Documentation
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your development machine:
- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- [npm](https://www.npmjs.com/) (v9.0.0 or higher)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) URI (or local MongoDB instance)
- *(Optional for Android builds)* Android SDK & JDK 17+

---

### 📥 Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/TAMILARASU25082006/Vibebox.git
   cd Vibebox
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory (or export environment variables in your shell):
   ```env
   PORT=3000
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_super_secret_jwt_key
   GOOGLE_CLIENT_ID=your_google_oauth_client_id
   ```

4. **Start the Development Server**:
   ```bash
   npm run dev
   # or
   npm start
   ```

5. **Open in Browser**:
   Navigate to [http://localhost:3000](http://localhost:3000).

---

## 📡 API Endpoints Reference

### 🔐 Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new user account |
| `POST` | `/api/auth/login` | Authenticate user & return JWT token |
| `POST` | `/api/auth/google` | Single Sign-On using Google OAuth ID Token |

### 🎵 Music & Streaming

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search?q={query}` | Search tracks via YouTube scraper |
| `GET` | `/api/suggest?q={query}` | Get search auto-complete suggestions |
| `GET` | `/api/stream/{videoId}` | Audio streaming stream endpoint |
| `GET` | `/api/lyrics?title={title}&artist={artist}` | Retrieve track lyrics |

### 📚 User Library & Playlists

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/user/library` | Yes | Fetch user's saved library & settings |
| `POST` | `/api/user/library/sync` | Yes | Sync client library state with cloud |
| `POST` | `/api/playlists/share` | Yes | Publish & generate public share ID for a playlist |
| `GET` | `/api/playlists/share/:id` | No | Fetch a shared playlist by share code |

---

## 📱 Building the Android APK

VibeBox includes native Capacitor support to package the web client into a standalone Android APK.

### Automated Build (Windows PowerShell)

Run the included build script:
```powershell
.\build_local_apk.ps1
```

This script automatically handles:
1. Copying web build assets to Capacitor target.
2. Running `npx cap sync android`.
3. Executing Gradle wrapper (`gradlew.bat assembleDebug`).
4. Copying output APK to `./public/vibebox-app.apk` for easy web downloading.

---

## ☁️ Deployment

### Deploying to Vercel

VibeBox includes a `vercel.json` routing configuration suitable for deployment as a Vercel Serverless application:

```bash
npm install -g vercel
vercel
```

---

## 📄 License

This project is licensed under the **ISC License**.

---

<p align="center">Crafted with ❤️ for music lovers everywhere.</p>
