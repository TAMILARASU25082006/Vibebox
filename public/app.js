/**
 * VIBEBOX CLIENT CORE APPLICATION LOGIC
 */

// --- GLOBAL APPLICATION STATE ---
// Detect if running inside Capacitor native webview wrapper
const isCapacitor = typeof window !== 'undefined' && (window.Capacitor || window.location.hostname === 'localhost' && !window.location.port);
const API_BASE = isCapacitor
  ? 'https://vibebox-eight.vercel.app' // Live production Vercel server for mobile app connectivity
  : (window.location.protocol.startsWith('http') ? '' : 'http://localhost:3000');


let library = {
  likedSongs: [],
  playlists: [],
  recentlyPlayed: [],
  settings: {
    theme: 'green',
    showVideo: true
  }
};

let playback = {
  queue: [],
  originalQueue: [], // Back-up copy to restore original order when un-shuffling
  currentIndex: -1,
  isPlaying: false,
  shuffleActive: false,
  repeatMode: 0, // 0 = off, 1 = repeat all, 2 = repeat one
  player: null, // YouTube YT.Player reference
  progressInterval: null
};

let activePlaylistId = null; // Track which custom playlist is open

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadLibraryFromStorage();
  applySettingsAndTheme();
  setupNavigation();
  setupSearchAndSuggestions();
  setupPlayerControls();
  setupPlaylistManagement();
  setupBackupManagement();
  setupAuthManagement();
  setupVoiceSearch();
  setupAccessibilityShortcuts();
  setupSidebarTabs();
  renderSidebarPlaylists();
  renderHomeViewport();
});

// Initialize background mode for mobile app
function initBackgroundMode() {
  if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
    try {
      window.cordova.plugins.backgroundMode.setDefaults({
        title: 'VibeBox Active Playback',
        text: 'Playing your favorite music in the background',
        icon: 'icon',
        color: '1DB954',
        silent: false
      });
      window.cordova.plugins.backgroundMode.enable();
      
      // Override Back Button to prevent app exit/destruction, sending it to background instead
      window.cordova.plugins.backgroundMode.overrideBackButton();
      
      // Disable WebView optimizations to prevent JS and media throttling on app minimize
      window.cordova.plugins.backgroundMode.on('activate', () => {
        window.cordova.plugins.backgroundMode.disableWebViewOptimizations();
      });
      

      console.log('BackgroundMode enabled successfully with WebView optimization overrides!');
      return true;
    } catch (err) {
      console.error('Error enabling BackgroundMode:', err);
    }
  }
  return false;
}

// Run immediately and try polling on load to ensure bridge is caught
document.addEventListener('deviceready', initBackgroundMode);
document.addEventListener('DOMContentLoaded', () => {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (initBackgroundMode() || attempts > 10) {
      clearInterval(interval);
    }
  }, 500);
});

// --- YOUTUBE IFRAME PLAYER API INTEGRATION ---
// This function initializes the player instance and is called safely
window.initializeYouTubePlayer = function() {
  if (playback.player) return; // Prevent double initialization
  playback.player = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    videoId: '', // Initialize empty
    playerVars: {
      'autoplay': 0,
      'controls': 0, // Hide YouTube controls so we use our own UI
      'disablekb': 1,
      'fs': 0,
      'modestbranding': 1,
      'rel': 0,
      'showinfo': 0,
      'iv_load_policy': 3,
      'playsinline': 1 // Crucial for background audio & mobile browsers inline play
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
};

// Check if the YouTube Iframe API ready callback was already fired before app.js loaded
if (window.youtubeAPIReady) {
  window.initializeYouTubePlayer();
}

function onPlayerReady(event) {
  // Sync volume from slider configuration
  const volumeSlider = document.getElementById('volume-slider');
  playback.player.setVolume(volumeSlider.value);
  
  // Set initial player bar state
  updatePlaybackUI();
}

function onPlayerStateChange(event) {
  const playPauseBtn = document.getElementById('ctrl-play-pause');
  const playIcon = playPauseBtn.querySelector('.play-icon');
  const pauseIcon = playPauseBtn.querySelector('.pause-icon');
  
  if (event.data === YT.PlayerState.PLAYING) {
    playback.isPlaying = true;
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    
    // Start progress scrubber polling loop
    startProgressPolling();
    
    // Keep browser audio context awake
    startSilentBackgroundAudio();
    
    // Add to recently played (only once when starting playback)
    const currentTrack = getActiveTrack();
    if (currentTrack) {
      addToRecentlyPlayed(currentTrack);
      updateMediaSession(currentTrack);
    }
  } else if (event.data === YT.PlayerState.PAUSED) {
    playback.isPlaying = false;
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    stopProgressPolling();
    
    // Pause silent background loop to save battery when user paused
    pauseSilentBackgroundAudio();
    
    const currentTrack = getActiveTrack();
    if (currentTrack) {
      updateMediaSession(currentTrack);
    }
  } else if (event.data === YT.PlayerState.ENDED) {
    playback.isPlaying = false;
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    stopProgressPolling();
    
    // Pause silent background loop on track completion
    pauseSilentBackgroundAudio();
    
    const currentTrack = getActiveTrack();
    if (currentTrack) {
      updateMediaSession(currentTrack);
    }
    handleTrackEnded();
  }
}

function onPlayerError(event) {
  console.error('YouTube Player Error:', event.data);
  // Auto-advance to next song on error (e.g. video blocked or deleted)
  playNextTrack();
}

// --- STATE PERSISTENCE (LOCAL STORAGE & CLOUD) ---
let authToken = localStorage.getItem('vibebox_token') || null;
let loggedInUser = localStorage.getItem('vibebox_username') || null;

async function loadLibraryFromStorage() {
  const stored = localStorage.getItem('vibebox_library');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      library = {
        likedSongs: parsed.likedSongs || [],
        playlists: parsed.playlists || [],
        recentlyPlayed: parsed.recentlyPlayed || [],
        settings: {
          theme: (parsed.settings && parsed.settings.theme) || 'green',
          showVideo: (parsed.settings && parsed.settings.showVideo !== undefined) ? parsed.settings.showVideo : true,
          quality: (parsed.settings && parsed.settings.quality) || 'highres'
        }
      };
    } catch (e) {
      console.error('Failed to parse stored library, using defaults.');
    }
  }
  
  // Try loading default volume
  const storedVolume = localStorage.getItem('vibebox_volume');
  if (storedVolume) {
    const volumeSlider = document.getElementById('volume-slider');
    const volumeProgress = document.getElementById('volume-progress');
    volumeSlider.value = storedVolume;
    volumeProgress.style.width = storedVolume + '%';
  }

  // Load from database if token exists
  if (authToken) {
    try {
      const res = await fetch(`${API_BASE}/api/library`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        library = data.library;
        localStorage.setItem('vibebox_library', JSON.stringify(library));
      } else if (res.status === 401 || res.status === 403) {
        logoutUser();
      }
    } catch (e) {
      console.error('Failed to fetch library from cloud, using cached local backup.', e);
    }
  }
  
  updateAuthUI();
}

async function saveLibraryToStorage() {
  localStorage.setItem('vibebox_library', JSON.stringify(library));
  
  // Cloud sync if authenticated
  if (authToken) {
    try {
      await fetch(`${API_BASE}/api/library/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ library })
      });
    } catch (e) {
      console.error('Cloud library sync failed.', e);
    }
  }
}

function applySettingsAndTheme() {
  // Apply Accent Theme
  const theme = library.settings.theme || 'green';
  document.documentElement.setAttribute('data-theme', theme);
  
  // Sync setting checkbox
  const showVideoCheckbox = document.getElementById('setting-show-video');
  showVideoCheckbox.checked = library.settings.showVideo;
  
  const videoMini = document.getElementById('video-mini-container');
  if (library.settings.showVideo) {
    videoMini.style.display = 'block';
    videoMini.classList.remove('video-hidden');
  } else {
    videoMini.style.display = 'block'; // Keep it block to keep the iframe rendering and playing
    videoMini.classList.add('video-hidden');
  }
  
  // Sync quality dropdown
  const qualitySelect = document.getElementById('setting-video-quality');
  if (qualitySelect) {
    qualitySelect.value = library.settings.quality || 'highres';
  }
  
  // Set active class in Settings theme picker
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

// --- ROUTING / VIEW NAVIGATION ---
function setupNavigation() {
  const navItems = [
    { id: 'nav-home', viewport: 'viewport-home' },
    { id: 'nav-search', viewport: 'viewport-search' },
    { id: 'nav-discover', viewport: 'viewport-discover' },
    { id: 'nav-liked', viewport: 'viewport-liked' },
    { id: 'nav-settings', viewport: 'viewport-settings' }
  ];
  
  navItems.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        switchViewport(item.viewport);
        
        // Update sidebar nav highlighting
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        el.classList.add('active');
        
        // Reset liked tag chips styling
        const likedChip = document.getElementById('nav-liked-chip');
        if (likedChip) likedChip.classList.remove('active');
        const allPlaylistsChip = document.getElementById('chip-all');
        if (allPlaylistsChip) allPlaylistsChip.classList.add('active');
        
        // Highlight sidebar playlist matching if active
        document.querySelectorAll('.playlist-link').forEach(link => link.classList.remove('active'));
      });
    }
  });

  // Library tags chip filters
  const likedChip = document.getElementById('nav-liked-chip');
  const allPlaylistsChip = document.getElementById('chip-all');
  
  if (likedChip) {
    likedChip.addEventListener('click', () => {
      switchViewport('viewport-liked');
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.playlist-link').forEach(el => el.classList.remove('active'));
      
      if (allPlaylistsChip) allPlaylistsChip.classList.remove('active');
      likedChip.classList.add('active');
    });
  }
  
  if (allPlaylistsChip) {
    allPlaylistsChip.addEventListener('click', () => {
      switchViewport('viewport-home');
      const homeNav = document.getElementById('nav-home');
      if (homeNav) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        homeNav.classList.add('active');
      }
      if (likedChip) likedChip.classList.remove('active');
      allPlaylistsChip.classList.add('active');
    });
  }

  // Mobile drawer navigation handling
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar-layout');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  if (mobileMenuBtn && sidebar && sidebarOverlay) {
    const toggleSidebar = () => {
      sidebar.classList.toggle('active');
      sidebarOverlay.classList.toggle('active');
    };

    const closeSidebar = () => {
      sidebar.classList.remove('active');
      sidebarOverlay.classList.remove('active');
    };

    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });

    sidebarOverlay.addEventListener('click', closeSidebar);
    
    // Automatically close sidebar on click of any nav item or playlist inside sidebar
    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) {
        closeSidebar();
      }
    });
  }

  // Header background blur on scroll
  const mainPanel = document.getElementById('main-panel');
  const topBar = document.getElementById('top-bar');
  if (mainPanel && topBar) {
    mainPanel.addEventListener('scroll', () => {
      if (mainPanel.scrollTop > 40) {
        topBar.classList.add('scrolled');
      } else {
        topBar.classList.remove('scrolled');
      }
    });
  }
}

function switchViewport(viewportId) {
  document.querySelectorAll('.viewport').forEach(v => {
    v.classList.remove('active');
  });
  const activeViewport = document.getElementById(viewportId);
  if (activeViewport) activeViewport.classList.add('active');
  
  // Perform page specific updates on route change
  if (viewportId === 'viewport-home') {
    renderHomeViewport();
  } else if (viewportId === 'viewport-liked') {
    renderLikedSongsViewport();
  } else if (viewportId === 'viewport-discover') {
    renderDiscoverViewport();
  }
}

function openPlaylistView(playlistId) {
  activePlaylistId = playlistId;
  const playlist = library.playlists.find(p => p.id === playlistId);
  if (!playlist) return;
  
  switchViewport('viewport-playlist');
  
  // Highlighting matching sidebar links
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.playlist-link').forEach(el => {
    el.classList.toggle('active', el.dataset.id === playlistId);
  });
  
  // Update Header details
  document.getElementById('playlist-view-title').textContent = playlist.name;
  document.getElementById('playlist-view-desc').textContent = playlist.description || 'No description provided.';
  document.getElementById('playlist-view-count').textContent = `${playlist.songs.length} song${playlist.songs.length === 1 ? '' : 's'}`;
  
  // Apply a dynamic background gradient cover based on playlist ID to make it look premium
  const playlistCover = document.getElementById('playlist-view-cover');
  const gradientIndex = Math.abs(hashCode(playlistId)) % 6;
  const gradients = [
    'linear-gradient(135deg, #1e1b4b, #311042)',
    'linear-gradient(135deg, #064e3b, #022c22)',
    'linear-gradient(135deg, #4c1d95, #1e1b4b)',
    'linear-gradient(135deg, #78350f, #451a03)',
    'linear-gradient(135deg, #172554, #0f172a)',
    'linear-gradient(135deg, #581c87, #020617)'
  ];
  playlistCover.style.background = gradients[gradientIndex];
  playlistCover.innerHTML = `<svg viewBox="0 0 24 24" width="70" height="70" opacity="0.3"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
  
  // Render playlist songs table
  renderTracklistTable(playlist.songs, 'playlist-songs-list', 'playlist-songs-empty-state', playlistId);

  // Configure action row buttons for personal custom playlists
  const shareBtn = document.getElementById('share-playlist-btn');
  const deleteBtn = document.getElementById('delete-playlist-btn');
  const likeBtn = document.getElementById('like-playlist-btn');
  const commentsContainer = document.getElementById('playlist-comments-container');
  
  shareBtn.style.display = authToken ? 'inline-block' : 'none';
  deleteBtn.style.display = 'inline-block';
  likeBtn.style.display = 'none';
  commentsContainer.style.display = 'none'; // Only for community playlists
  
  shareBtn.onclick = async () => {
    if (!authToken) {
      alert('Please sign in to share your playlist with the community!');
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/api/playlists/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: playlist.name,
          description: playlist.description,
          songs: playlist.songs
        })
      });
      if (res.ok) {
        alert(`Successfully shared playlist "${playlist.name}" to the Community discover board!`);
      } else {
        const data = await res.json();
        alert(`Failed to share: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Network error. Failed to publish playlist.');
    }
  };
}

function renderHomeViewport() {
  // Update Greeting based on Local Hour
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';
  document.getElementById('greeting-text').textContent = greeting;
  
  // Render Recently Played Section
  const recGrid = document.getElementById('recently-played-grid');
  if (library.recentlyPlayed.length === 0) {
    recGrid.innerHTML = `<p class="empty-state">No recently played songs. Try searching for one!</p>`;
  } else {
    recGrid.innerHTML = '';
    library.recentlyPlayed.forEach(song => {
      recGrid.appendChild(createMusicCard(song));
    });
  }
  
  // Render Featured Section
  const featuredGrid = document.getElementById('featured-playlists-grid');
  featuredGrid.innerHTML = '';
  
  // Static Featured Playlists
  const featuredList = [
    { title: 'Lofi Chilled Beats', query: 'lofi study beats hip hop study relaxing', desc: 'Focus or unwind with lo-fi beats.' },
    { title: 'Gaming Focus', query: 'gaming music synthwave cyber instrumental', desc: 'Instrumental music to lock into games.' },
    { title: 'Acoustic Cover Hits', query: 'acoustic guitar pop covers live session', desc: 'Beautiful acoustic versions of popular songs.' },
    { title: 'Synthwave Retro', query: 'synthwave 80s retrowave outrun synth', desc: 'Neon synth beats from another decade.' }
  ];
  
  featuredList.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'music-card';
    
    // Choose cover art gradients
    const gradients = [
      'linear-gradient(135deg, #10b981, #047857)',
      'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      'linear-gradient(135deg, #f97316, #c2410c)',
      'linear-gradient(135deg, #ec4899, #be185d)'
    ];
    
    card.innerHTML = `
      <div class="card-image-wrapper">
        <div style="width:100%; height:100%; background:${gradients[idx]}; display:flex; align-items:center; justify-content:center; color:#fff;">
          <svg viewBox="0 0 24 24" width="48" height="48" opacity="0.4"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2,12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
        </div>
        <button class="card-play-btn" title="Play Playlist">
          <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <div class="card-title">${item.title}</div>
      <div class="card-artist">${item.desc}</div>
    `;
    
    // Play button on card searches & queues the query tracks
    card.addEventListener('click', (e) => {
      // If client clicked the play button overlay, fetch search query and auto-play
      if (e.target.closest('.card-play-btn')) {
        e.stopPropagation();
        triggerFeaturedPlay(item.query);
      } else {
        // Navigate to search and query the topic
        document.getElementById('global-search-input').value = item.title;
        triggerSearch(item.query);
        switchViewport('viewport-search');
      }
    });
    
    featuredGrid.appendChild(card);
  });
}

function renderLikedSongsViewport() {
  document.getElementById('liked-songs-count').textContent = `${library.likedSongs.length} song${library.likedSongs.length === 1 ? '' : 's'}`;
  renderTracklistTable(library.likedSongs, 'liked-songs-list', 'liked-songs-empty-state', 'liked');
}

// Helper to trigger play of search result songs instantly
async function triggerFeaturedPlay(query) {
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      playAllTracklist(data.results);
    }
  } catch (err) {
    console.error('Failed to trigger play on query:', err);
  }
}

// --- SEARCH CONTROLS ---
function setupSearchAndSuggestions() {
  const searchInput = document.getElementById('global-search-input');
  const suggestionsBox = document.getElementById('suggestions-box');
  const clearBtn = document.getElementById('clear-search-btn');
  
  let debounceTimeout = null;
  
  // Real-time query suggestion lookup
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    clearBtn.style.display = val.length > 0 ? 'block' : 'none';
    
    if (debounceTimeout) clearTimeout(debounceTimeout);
    
    if (!val) {
      suggestionsBox.style.display = 'none';
      return;
    }
    
    debounceTimeout = setTimeout(() => {
      fetch(`${API_BASE}/api/suggest?q=${encodeURIComponent(val)}`)
        .then(res => res.json())
        .then(data => {
          if (data.suggestions && data.suggestions.length > 0) {
            suggestionsBox.innerHTML = '';
            data.suggestions.slice(0, 5).forEach(sug => {
              const item = document.createElement('div');
              item.className = 'suggestion-item';
              item.textContent = sug;
              item.addEventListener('click', () => {
                searchInput.value = sug;
                suggestionsBox.style.display = 'none';
                triggerSearch(sug);
                switchViewport('viewport-search');
              });
              suggestionsBox.appendChild(item);
            });
            suggestionsBox.style.display = 'block';
          } else {
            suggestionsBox.style.display = 'none';
          }
        })
        .catch(() => {
          suggestionsBox.style.display = 'none';
        });
    }, 250);
  });
  
  // Perform search on ENTER
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = searchInput.value.trim();
      if (val) {
        suggestionsBox.style.display = 'none';
        triggerSearch(val);
        switchViewport('viewport-search');
      }
    }
  });
  
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    suggestionsBox.style.display = 'none';
    searchInput.focus();
  });
  
  // Close suggestions box if clicked outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box-container')) {
      suggestionsBox.style.display = 'none';
    }
  });
}

async function triggerSearch(query) {
  const grid = document.getElementById('search-results-grid');
  document.getElementById('search-query-label').textContent = `Showing results for "${query}"`;
  
  // Show loading indicator
  grid.innerHTML = `
    <div class="search-placeholder-state">
      <svg class="placeholder-icon" viewBox="0 0 24 24" width="48" height="48" class="rotating"><path fill="currentColor" d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 16c4.41 0 8-3.59 8-8h2c0 5.52-4.48 10-10 10z"/></svg>
      <h3>Searching database...</h3>
    </div>
  `;
  
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    
    if (data.results && data.results.length > 0) {
      grid.innerHTML = '';
      data.results.forEach(song => {
        grid.appendChild(createMusicCard(song));
      });
    } else {
      grid.innerHTML = `
        <div class="search-placeholder-state">
          <h3>No tracks found</h3>
          <p>We couldn't find matches for "${query}". Check spelling or try a different term.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to search:', err);
    grid.innerHTML = `
      <div class="search-placeholder-state">
        <h3>Search Error</h3>
        <p>Something went wrong query. Error: ${err.message}</p>
      </div>
    `;
  }
}

// Music Card Element Generator
function createMusicCard(song) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.dataset.id = song.videoId;
  
  card.innerHTML = `
    <div class="card-image-wrapper">
      <img src="${song.thumbnail}" class="card-img" alt="${song.title}">
      <span class="card-duration">${song.duration}</span>
      <button class="card-play-btn" title="Play">
        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
      </button>
    </div>
    <div class="card-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
    <div class="card-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
  `;
  
  // Play song on click of the hover play overlay
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-play-btn')) {
      e.stopPropagation();
      playTrackInstant(song);
    } else {
      // Clicking the card body shows custom context options to add to playlists
      showTrackContextMenu(e, song);
    }
  });
  
  return card;
}

// Render Table Rows for Liked Songs or Custom Playlists
function renderTracklistTable(songs, containerId, emptyStateId, listContext) {
  const container = document.getElementById(containerId);
  const emptyState = document.getElementById(emptyStateId);
  
  if (songs.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  container.innerHTML = '';
  
  songs.forEach((song, idx) => {
    const row = document.createElement('tr');
    row.className = 'track-row';
    row.dataset.id = song.videoId;
    
    // Check if this row is currently playing
    const active = getActiveTrack();
    const isPlayingRow = active && active.videoId === song.videoId;
    if (isPlayingRow) {
      row.classList.add('playing');
    }
    
    const isLiked = isSongLiked(song.videoId);
    const heartClass = isLiked ? 'active' : '';
    
    row.innerHTML = `
      <td class="col-index">${idx + 1}</td>
      <td class="col-title">
        <img src="${song.thumbnail}" class="track-thumb" alt="">
        <div class="track-title-info" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
      </td>
      <td class="col-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</td>
      <td class="col-duration">${song.duration}</td>
      <td class="col-actions">
        <button class="row-action-btn heart-btn ${heartClass}" title="Like song">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
        <button class="row-action-btn delete-track-btn" title="Remove track">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </td>
    `;
    
    // Play on row double click or single click to select and play
    row.addEventListener('click', (e) => {
      // Stop execution if clicking on action buttons
      if (e.target.closest('.row-action-btn')) return;
      
      // Play this track list from this current track index onwards!
      const songIndex = idx;
      playAllTracklistFromIndex(songs, songIndex);
    });
    
    // Heart toggle listener
    row.querySelector('.heart-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLikeSong(song);
      
      // Update UI row state instantly
      const isNowLiked = isSongLiked(song.videoId);
      e.currentTarget.classList.toggle('active', isNowLiked);
      
      // If we are on Liked Songs page, re-render immediately
      const activeViewport = document.querySelector('.viewport.active');
      if (activeViewport.id === 'viewport-liked') {
        renderLikedSongsViewport();
      }
    });
    
    // Remove track click listener
    row.querySelector('.delete-track-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (listContext === 'liked') {
        toggleLikeSong(song); // removes from liked
        renderLikedSongsViewport();
      } else {
        removeSongFromPlaylist(listContext, song.videoId);
        openPlaylistView(listContext);
      }
    });
    
    container.appendChild(row);
  });
}

// --- CORE PLAYBACK CONTROLS ---
function setupPlayerControls() {
  const playPauseBtn = document.getElementById('ctrl-play-pause');
  const prevBtn = document.getElementById('ctrl-prev');
  const nextBtn = document.getElementById('ctrl-next');
  const shuffleBtn = document.getElementById('ctrl-shuffle');
  const repeatBtn = document.getElementById('ctrl-repeat');
  
  const timelineSlider = document.getElementById('timeline-slider');
  const volumeSlider = document.getElementById('volume-slider');
  const muteBtn = document.getElementById('ctrl-mute');
  const queueBtn = document.getElementById('ctrl-queue');
  const closeQueueBtn = document.getElementById('close-queue-btn');
  const clearQueueBtn = document.getElementById('clear-queue-btn');
  const videoExpandBtn = document.getElementById('video-expand-btn');
  
  // Play/Pause Click Handler
  playPauseBtn.addEventListener('click', () => {
    if (!playback.player) return;
    
    if (playback.isPlaying) {
      playback.player.pauseVideo();
    } else {
      // If nothing is queued, let's load a default song or play liked songs
      if (playback.queue.length === 0) {
        if (library.likedSongs.length > 0) {
          playAllTracklist(library.likedSongs);
        } else {
          // Play a default fallback track (lofi chill)
          playTrackInstant({
            videoId: '5qap5aO4i9A',
            title: 'Lofi Girl Live - Beats to Relax/Study to',
            artist: 'Lofi Girl',
            thumbnail: 'https://i.ytimg.com/vi/5qap5aO4i9A/hqdefault.jpg',
            duration: 'Live'
          });
        }
      } else {
        playback.player.playVideo();
      }
    }
  });
  
  // Forward/Previous Click Handlers
  nextBtn.addEventListener('click', () => playNextTrack());
  prevBtn.addEventListener('click', () => playPreviousTrack());
  
  // Shuffle Click Handler
  shuffleBtn.addEventListener('click', () => {
    playback.shuffleActive = !playback.shuffleActive;
    shuffleBtn.classList.toggle('active', playback.shuffleActive);
    
    if (playback.shuffleActive) {
      // Backup original order
      playback.originalQueue = [...playback.queue];
      // Shuffle the remaining queue
      const active = getActiveTrack();
      const currentIndex = playback.currentIndex;
      
      let itemsToShuffle = [];
      playback.queue.forEach((item, index) => {
        if (index !== currentIndex) {
          itemsToShuffle.push(item);
        }
      });
      
      // Fisher-Yates Shuffle
      for (let i = itemsToShuffle.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [itemsToShuffle[i], itemsToShuffle[j]] = [itemsToShuffle[j], itemsToShuffle[i]];
      }
      
      // Assemble new queue with current track at position 0
      if (active) {
        playback.queue = [active, ...itemsToShuffle];
        playback.currentIndex = 0;
      } else {
        playback.queue = itemsToShuffle;
        playback.currentIndex = -1;
      }
    } else {
      // Restore original queue order
      const active = getActiveTrack();
      if (active && playback.originalQueue.length > 0) {
        playback.queue = [...playback.originalQueue];
        playback.currentIndex = playback.queue.findIndex(s => s.videoId === active.videoId);
      }
    }
    
    renderQueuePanel();
  });
  
  // Repeat Click Handler
  repeatBtn.addEventListener('click', () => {
    playback.repeatMode = (playback.repeatMode + 1) % 3;
    const badge = repeatBtn.querySelector('.repeat-badge');
    
    if (playback.repeatMode === 0) {
      repeatBtn.classList.remove('active');
      badge.style.display = 'none';
    } else if (playback.repeatMode === 1) {
      repeatBtn.classList.add('active');
      badge.style.display = 'none';
    } else if (playback.repeatMode === 2) {
      repeatBtn.classList.add('active');
      badge.style.display = 'inline';
    }
  });
  
  // Timeline scrub bar click/drag behavior
  let isDraggingSlider = false;
  timelineSlider.addEventListener('mousedown', () => {
    isDraggingSlider = true;
  });
  
  timelineSlider.addEventListener('mouseup', () => {
    isDraggingSlider = false;
  });
  
  timelineSlider.addEventListener('change', () => {
    if (!playback.player) return;
    const duration = playback.player.getDuration() || 0;
    const seconds = (timelineSlider.value / 100) * duration;
    playback.player.seekTo(seconds, true);
    
    const progress = document.getElementById('timeline-progress');
    progress.style.width = timelineSlider.value + '%';
  });
  
  // Update progress bar track fills live during slide
  timelineSlider.addEventListener('input', () => {
    const progress = document.getElementById('timeline-progress');
    progress.style.width = timelineSlider.value + '%';
    
    // Update live timer labels during seek drag
    if (playback.player) {
      const duration = playback.player.getDuration() || 0;
      const current = (timelineSlider.value / 100) * duration;
      document.getElementById('time-current').textContent = formatSeconds(current);
    }
  });
  
  // Volume controller scrubber
  volumeSlider.addEventListener('input', () => {
    const val = volumeSlider.value;
    document.getElementById('volume-progress').style.width = val + '%';
    if (playback.player) {
      playback.player.setVolume(val);
      playback.player.unMute();
    }
    
    localStorage.setItem('vibebox_volume', val);
    
    // Update speaker SVG state
    updateVolumeIconState(val, false);
  });
  
  // Toggle Mute Click Handler
  muteBtn.addEventListener('click', () => {
    if (!playback.player) return;
    
    const isMuted = playback.player.isMuted();
    if (isMuted) {
      playback.player.unMute();
      volumeSlider.value = localStorage.getItem('vibebox_volume') || 50;
      document.getElementById('volume-progress').style.width = volumeSlider.value + '%';
      updateVolumeIconState(volumeSlider.value, false);
    } else {
      playback.player.mute();
      volumeSlider.value = 0;
      document.getElementById('volume-progress').style.width = '0%';
      updateVolumeIconState(0, true);
    }
  });
  
  // Toggle Queue Panel Drawers
  const toggleQueue = () => {
    const queuePanel = document.getElementById('queue-panel');
    queuePanel.classList.toggle('collapsed');
    renderQueuePanel();
  };
  
  queueBtn.addEventListener('click', toggleQueue);
  closeQueueBtn.addEventListener('click', toggleQueue);
  
  clearQueueBtn.addEventListener('click', () => {
    playback.queue = [];
    playback.originalQueue = [];
    playback.currentIndex = -1;
    if (playback.player) {
      playback.player.stopVideo();
    }
    updatePlaybackUI();
    renderQueuePanel();
  });
  
  // Toggle Expand Floating Video Mini-Player
  videoExpandBtn.addEventListener('click', () => {
    const videoContainer = document.getElementById('video-mini-container');
    videoContainer.classList.toggle('maximized');
  });

  // Fullscreen Cinema mode listener
  const fullscreenBtn = document.getElementById('video-fullscreen-btn');
  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const videoContainer = document.getElementById('video-mini-container');
    if (!document.fullscreenElement) {
      videoContainer.requestFullscreen().catch(err => {
        console.error('Error entering fullscreen:', err.message);
      });
    } else {
      document.exitFullscreen();
    }
  });
  
  // Timeline scrubber polling
  window.addEventListener('keydown', (e) => {
    // Media keys handling or spacebar play/pause (only when not focused in input)
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      playPauseBtn.click();
    }
  });

  // Register OS Media Session Action Handlers
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
      playPauseBtn.click();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      playPauseBtn.click();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playPreviousTrack();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNextTrack();
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      if (playback.player) {
        const offset = details.seekOffset || 10;
        const current = playback.player.getCurrentTime() || 0;
        playback.player.seekTo(Math.max(current - offset, 0), true);
      }
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      if (playback.player) {
        const offset = details.seekOffset || 10;
        const current = playback.player.getCurrentTime() || 0;
        const duration = playback.player.getDuration() || 0;
        playback.player.seekTo(Math.min(current + offset, duration), true);
      }
    });
  }
}

function updateVolumeIconState(val, isMuted) {
  const upIcon = document.querySelector('.vol-up-icon');
  const muteIcon = document.querySelector('.vol-mute-icon');
  
  if (isMuted || val == 0) {
    upIcon.style.display = 'none';
    muteIcon.style.display = 'block';
  } else {
    upIcon.style.display = 'block';
    muteIcon.style.display = 'none';
  }
}

// Scrubber Polling Loop
function startProgressPolling() {
  stopProgressPolling();
  playback.progressInterval = setInterval(() => {
    if (!playback.player || !playback.isPlaying) return;
    
    const current = playback.player.getCurrentTime() || 0;
    const duration = playback.player.getDuration() || 0;
    
    // Update Labels
    document.getElementById('time-current').textContent = formatSeconds(current);
    document.getElementById('time-duration').textContent = formatSeconds(duration);
    
    // Update Slider inputs (if user is not dragging it right now)
    const timelineSlider = document.getElementById('timeline-slider');
    const isDragging = document.activeElement === timelineSlider;
    if (duration > 0 && !isDragging) {
      const pct = (current / duration) * 100;
      timelineSlider.value = pct;
      document.getElementById('timeline-progress').style.width = pct + '%';
    }
  }, 500);
}

function stopProgressPolling() {
  if (playback.progressInterval) {
    clearInterval(playback.progressInterval);
    playback.progressInterval = null;
  }
}

// --- QUEUE ACTIONS & PLAYBACK FLOW ---
function getActiveTrack() {
  if (playback.currentIndex >= 0 && playback.currentIndex < playback.queue.length) {
    return playback.queue[playback.currentIndex];
  }
  return null;
}

function playTrackInstant(song) {
  // Clear queue and replace with single item
  playback.queue = [song];
  playback.originalQueue = [song];
  playback.currentIndex = 0;
  loadAndPlayVideo(song.videoId);
}

function playAllTracklist(songs) {
  if (songs.length === 0) return;
  playback.queue = [...songs];
  playback.originalQueue = [...songs];
  playback.currentIndex = 0;
  
  if (playback.shuffleActive) {
    // If shuffle is active, shuffle the queue immediately
    playback.currentIndex = Math.floor(Math.random() * songs.length);
  }
  
  const active = playback.queue[playback.currentIndex];
  loadAndPlayVideo(active.videoId);
}

function playAllTracklistFromIndex(songs, index) {
  playback.queue = [...songs];
  playback.originalQueue = [...songs];
  playback.currentIndex = index;
  
  const active = playback.queue[playback.currentIndex];
  loadAndPlayVideo(active.videoId);
}

function loadAndPlayVideo(videoId) {
  if (!playback.player) return;
  
  playback.player.loadVideoById(videoId);
  
  // Apply preferred video streaming quality
  const preferredQuality = library.settings.quality || 'highres';
  playback.player.setPlaybackQuality(preferredQuality);
  
  playback.player.playVideo();
  
  // Start silent background loop to keep audio context awake on mobile browsers
  startSilentBackgroundAudio();
  
  // Highlight active items across viewport lists
  updateActiveRowHighlighting();
  updatePlaybackUI();
  
  // Load lyrics for the active track
  fetchActiveTrackLyrics();
}

function playNextTrack() {
  if (playback.queue.length === 0) return;
  
  playback.currentIndex++;
  if (playback.currentIndex >= playback.queue.length) {
    // Loop back to start if repeat all is active
    if (playback.repeatMode === 1) {
      playback.currentIndex = 0;
    } else {
      playback.currentIndex = playback.queue.length - 1;
      if (playback.player) playback.player.stopVideo();
      updatePlaybackUI();
      return;
    }
  }
  
  const nextTrack = playback.queue[playback.currentIndex];
  loadAndPlayVideo(nextTrack.videoId);
}

function playPreviousTrack() {
  if (playback.queue.length === 0) return;
  
  playback.currentIndex--;
  if (playback.currentIndex < 0) {
    if (playback.repeatMode === 1) {
      playback.currentIndex = playback.queue.length - 1;
    } else {
      playback.currentIndex = 0;
    }
  }
  
  const prevTrack = playback.queue[playback.currentIndex];
  loadAndPlayVideo(prevTrack.videoId);
}

function handleTrackEnded() {
  if (playback.repeatMode === 2) {
    // Loop current song single
    if (playback.player) {
      playback.player.seekTo(0);
      playback.player.playVideo();
    }
  } else {
    // Play next
    playNextTrack();
  }
}

// Update bottom player text details and heart state
function updatePlaybackUI() {
  const current = getActiveTrack();
  const infoContainer = document.getElementById('player-track-info');
  
  if (!current) {
    infoContainer.style.visibility = 'hidden';
    document.getElementById('ctrl-play-pause').querySelector('.play-icon').style.display = 'block';
    document.getElementById('ctrl-play-pause').querySelector('.pause-icon').style.display = 'none';
    document.getElementById('time-current').textContent = '0:00';
    document.getElementById('time-duration').textContent = '0:00';
    document.getElementById('timeline-slider').value = 0;
    document.getElementById('timeline-progress').style.width = '0%';
    return;
  }
  
  infoContainer.style.visibility = 'visible';
  document.getElementById('player-art').src = current.thumbnail;
  document.getElementById('player-title').textContent = current.title;
  document.getElementById('player-artist').textContent = current.artist;
  
  // Heart/Liked state
  const likedBtn = document.getElementById('player-heart');
  const isLiked = isSongLiked(current.videoId);
  likedBtn.classList.toggle('active', isLiked);
  
  // Heart Toggle Handler on Player Bar
  likedBtn.onclick = (e) => {
    e.stopPropagation();
    toggleLikeSong(current);
    likedBtn.classList.toggle('active', isSongLiked(current.videoId));
    
    // Update views that contain this list
    const activeViewport = document.querySelector('.viewport.active');
    if (activeViewport.id === 'viewport-liked') {
      renderLikedSongsViewport();
    } else if (activeViewport.id === 'viewport-playlist') {
      openPlaylistView(activePlaylistId);
    }
  };
  
  // Render active row highlighting
  updateActiveRowHighlighting();

  // Update OS Media Session notification details
  updateMediaSession(current);

  // Update dynamic canvas gradient background
  updateDynamicHeaderGradient(current);
}

// --- OS MEDIA SESSION INTEGRATION ---
let mediaSessionActionsSet = false;

function setupMediaSessionActions() {
  if (mediaSessionActionsSet) return;
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        if (playback.player) {
          playback.player.playVideo();
          startSilentBackgroundAudio();
        }
      });
      
      navigator.mediaSession.setActionHandler('pause', () => {
        if (playback.player) {
          playback.player.pauseVideo();
          pauseSilentBackgroundAudio();
        }
      });
      
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPreviousTrack();
      });
      
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNextTrack();
      });
      
      mediaSessionActionsSet = true;
    } catch (e) {
      console.error('Error registering MediaSession action handlers:', e);
    }
  }
}

// Silent audio context to keep mobile browser tabs awake in background
let silentHtmlAudio = null;

function startSilentBackgroundAudio() {
  if (silentHtmlAudio) {
    if (silentHtmlAudio.paused) {
      silentHtmlAudio.play().catch(e => console.log('Silent audio resume play failed:', e));
    }
    return;
  }
  
  try {
    // Base64 encoding of a 1-second silent WAV file
    const silentBase64 = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
    silentHtmlAudio = new Audio(silentBase64);
    silentHtmlAudio.loop = true;
    silentHtmlAudio.volume = 0.01;
    
    silentHtmlAudio.play().catch(err => {
      console.log("Silent background audio play prevented:", err);
    });
  } catch (err) {
    console.error("Error creating/playing silent background audio:", err);
  }
}

function pauseSilentBackgroundAudio() {
  if (silentHtmlAudio && !silentHtmlAudio.paused) {
    try {
      silentHtmlAudio.pause();
    } catch (e) {
      console.error("Error pausing silent background audio:", e);
    }
  }
}

function updateMediaSession(track) {
  if (!track) return;
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: 'VibeBox',
        artwork: [
          { src: track.thumbnail, sizes: '96x96', type: 'image/jpeg' },
          { src: track.thumbnail, sizes: '128x128', type: 'image/jpeg' },
          { src: track.thumbnail, sizes: '192x192', type: 'image/jpeg' },
          { src: track.thumbnail, sizes: '256x256', type: 'image/jpeg' },
          { src: track.thumbnail, sizes: '384x384', type: 'image/jpeg' },
          { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
        ]
      });
      navigator.mediaSession.playbackState = playback.isPlaying ? 'playing' : 'paused';
      
      // Auto-register action handlers once media starts
      setupMediaSessionActions();
    } catch (e) {
      console.error('Error updating MediaSession metadata:', e);
    }
  }
}

function updateActiveRowHighlighting() {
  const active = getActiveTrack();
  document.querySelectorAll('.track-row').forEach(row => {
    const isNowPlaying = active && row.dataset.id === active.videoId;
    row.classList.toggle('playing', isNowPlaying);
  });
}

// Render dynamic Right Drawer Queue List
function renderQueuePanel() {
  const nowCard = document.getElementById('queue-now-playing-card');
  const queueList = document.getElementById('queue-songs-list');
  
  const active = getActiveTrack();
  if (!active) {
    nowCard.innerHTML = `<p class="empty-state">No track playing</p>`;
  } else {
    nowCard.innerHTML = `
      <img src="${active.thumbnail}" class="queue-item-thumb" alt="">
      <div class="queue-item-info">
        <div class="queue-item-title" title="${escapeHtml(active.title)}">${escapeHtml(active.title)}</div>
        <div class="queue-item-artist" title="${escapeHtml(active.artist)}">${escapeHtml(active.artist)}</div>
      </div>
    `;
  }
  
  queueList.innerHTML = '';
  // Show only upcoming items in queue
  const upcomingSongs = playback.queue.slice(playback.currentIndex + 1);
  
  if (upcomingSongs.length === 0) {
    queueList.innerHTML = `<p class="empty-state">Queue is empty. Songs you add will show up here.</p>`;
    return;
  }
  
  upcomingSongs.forEach((song, offset) => {
    const queueIndex = playback.currentIndex + 1 + offset;
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.dataset.index = queueIndex;
    
    item.innerHTML = `
      <img src="${song.thumbnail}" class="queue-item-thumb" alt="">
      <div class="queue-item-info">
        <div class="queue-item-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
        <div class="queue-item-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
      </div>
      <button class="row-action-btn remove-queue-btn" title="Remove from queue">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
      </button>
    `;
    
    // Play item if clicked in queue
    item.addEventListener('click', (e) => {
      if (e.target.closest('.remove-queue-btn')) return;
      playback.currentIndex = queueIndex;
      loadAndPlayVideo(song.videoId);
      renderQueuePanel();
    });
    
    // Remove queue item click handler
    item.querySelector('.remove-queue-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      playback.queue.splice(queueIndex, 1);
      
      // Update original queue backup as well
      const backupIndex = playback.originalQueue.findIndex(s => s.videoId === song.videoId);
      if (backupIndex !== -1) {
        playback.originalQueue.splice(backupIndex, 1);
      }
      
      renderQueuePanel();
    });
    
    queueList.appendChild(item);
  });
}

// --- LIBRARY & PLAYLIST MANAGEMENT ---
function setupPlaylistManagement() {
  const createBtn = document.getElementById('create-playlist-btn');
  const modal = document.getElementById('playlist-modal');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const saveBtn = document.getElementById('modal-save-btn');
  const closeBtn = document.getElementById('modal-close-btn');
  
  const nameInput = document.getElementById('playlist-name-input');
  const descInput = document.getElementById('playlist-desc-input');
  
  createBtn.addEventListener('click', () => {
    nameInput.value = '';
    descInput.value = '';
    modal.style.display = 'flex';
    nameInput.focus();
  });
  
  const closeModal = () => { modal.style.display = 'none'; };
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    
    const newPlaylist = {
      id: 'pl_' + Date.now().toString(36),
      name: name,
      description: descInput.value.trim(),
      songs: []
    };
    
    library.playlists.push(newPlaylist);
    saveLibraryToStorage();
    renderSidebarPlaylists();
    closeModal();
    
    // Auto navigate to new playlist
    openPlaylistView(newPlaylist.id);
  });
  
  // Playlist table actions
  document.getElementById('play-all-liked').addEventListener('click', () => {
    playAllTracklist(library.likedSongs);
  });
  
  document.getElementById('play-all-playlist').addEventListener('click', () => {
    const pl = library.playlists.find(p => p.id === activePlaylistId);
    if (pl && pl.songs.length > 0) {
      playAllTracklist(pl.songs);
    }
  });
  
  document.getElementById('delete-playlist-btn').addEventListener('click', () => {
    if (!activePlaylistId) return;
    
    if (confirm('Are you sure you want to delete this playlist?')) {
      library.playlists = library.playlists.filter(p => p.id !== activePlaylistId);
      saveLibraryToStorage();
      renderSidebarPlaylists();
      switchViewport('viewport-home');
      activePlaylistId = null;
    }
  });
}

function renderSidebarPlaylists() {
  const container = document.getElementById('playlists-list-container');
  container.innerHTML = '';
  
  library.playlists.forEach(pl => {
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'playlist-link';
    link.dataset.id = pl.id;
    link.textContent = pl.name;
    
    if (activePlaylistId === pl.id && document.querySelector('#viewport-playlist').classList.contains('active')) {
      link.classList.add('active');
    }
    
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openPlaylistView(pl.id);
    });
    
    container.appendChild(link);
  });
}

function isSongLiked(videoId) {
  return library.likedSongs.some(s => s.videoId === videoId);
}

function toggleLikeSong(song) {
  const isLiked = isSongLiked(song.videoId);
  if (isLiked) {
    library.likedSongs = library.likedSongs.filter(s => s.videoId !== song.videoId);
  } else {
    // Add to top of liked songs
    library.likedSongs.unshift({ ...song });
  }
  saveLibraryToStorage();
}

function addSongToPlaylist(playlistId, song) {
  const pl = library.playlists.find(p => p.id === playlistId);
  if (!pl) return;
  
  // Prevent duplicate additions
  if (!pl.songs.some(s => s.videoId === song.videoId)) {
    pl.songs.push({ ...song });
    saveLibraryToStorage();
  }
}

function removeSongFromPlaylist(playlistId, videoId) {
  const pl = library.playlists.find(p => p.id === playlistId);
  if (!pl) return;
  
  pl.songs = pl.songs.filter(s => s.videoId !== videoId);
  saveLibraryToStorage();
}

function addToRecentlyPlayed(song) {
  // Check if song is already at position 0 to avoid duplicates on loops/clicks
  if (library.recentlyPlayed.length > 0 && library.recentlyPlayed[0].videoId === song.videoId) {
    return;
  }
  
  // Remove duplicate elsewhere in array
  library.recentlyPlayed = library.recentlyPlayed.filter(s => s.videoId !== song.videoId);
  
  // Add to start
  library.recentlyPlayed.unshift({ ...song });
  
  // Cap at 10 items
  if (library.recentlyPlayed.length > 10) {
    library.recentlyPlayed.pop();
  }
  saveLibraryToStorage();
}

// --- CONTEXT MENUS (ADD TO PLAYLIST POPUPS) ---
function showTrackContextMenu(event, song) {
  event.preventDefault();
  
  const menu = document.getElementById('context-menu');
  const container = document.getElementById('context-playlists-list');
  
  if (library.playlists.length === 0) {
    container.innerHTML = `
      <div style="padding: 10px 16px; font-size:12px; color:var(--text-muted);">
        No playlists created. Create one in the sidebar first!
      </div>
    `;
  } else {
    container.innerHTML = '';
    library.playlists.forEach(pl => {
      const item = document.createElement('button');
      item.className = 'context-item';
      item.textContent = pl.name;
      item.addEventListener('click', () => {
        addSongToPlaylist(pl.id, song);
        menu.style.display = 'none';
        
        // Show short confirmation
        alert(`Added "${song.title}" to playlist "${pl.name}"!`);
      });
      container.appendChild(item);
    });
  }
  
  // Position menu at pointer coordinates
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.style.display = 'block';
  
  // Close menu on clicks elsewhere
  const closeMenu = (e) => {
    if (!e.target.closest('#context-menu')) {
      menu.style.display = 'none';
      document.removeEventListener('click', closeMenu);
    }
  };
  
  // Delay listener activation to prevent immediate closure on click trigger
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 10);
}

// --- BACKUP & BACKEND SETTINGS ---
function setupBackupManagement() {
  const exportBtn = document.getElementById('export-library-btn');
  const triggerImportBtn = document.getElementById('trigger-import-btn');
  const importFileInput = document.getElementById('import-library-file');
  
  // Themes Picker
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      library.settings.theme = theme;
      saveLibraryToStorage();
      applySettingsAndTheme();
    });
  });
  
  // Playback settings toggle
  document.getElementById('setting-show-video').addEventListener('change', (e) => {
    library.settings.showVideo = e.target.checked;
    saveLibraryToStorage();
    applySettingsAndTheme();
  });

  // Playback settings quality dropdown change
  document.getElementById('setting-video-quality').addEventListener('change', (e) => {
    library.settings.quality = e.target.value;
    saveLibraryToStorage();
    
    // If player is active, apply quality immediately
    if (playback.player && playback.player.setPlaybackQuality) {
      playback.player.setPlaybackQuality(e.target.value);
    }
  });
  
  // Export Library JSON
  exportBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(library, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `vibebox_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  });
  
  // Trigger file dialog
  triggerImportBtn.addEventListener('click', () => {
    importFileInput.click();
  });
  
  // Import file handler
  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        
        // Merge or replace confirmation
        if (confirm('This will replace your current VibeBox library and settings. Do you want to proceed?')) {
          library = {
            likedSongs: parsed.likedSongs || [],
            playlists: parsed.playlists || [],
            recentlyPlayed: parsed.recentlyPlayed || [],
            settings: parsed.settings || { theme: 'green', showVideo: true }
          };
          saveLibraryToStorage();
          applySettingsAndTheme();
          renderSidebarPlaylists();
          renderHomeViewport();
          
          alert('Library successfully imported!');
        }
      } catch (err) {
        alert('Failed to parse the backup file. Please make sure it is a valid VibeBox JSON backup.');
      }
    };
    reader.readAsText(file);
    
    // Clear input value
    importFileInput.value = '';
  });
}

// --- UTILITY HELPERS ---
function formatSeconds(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- USER AUTHENTICATION CONTROLLER ---
function setupAuthManagement() {
  const badgeBtn = document.getElementById('profile-badge-btn');
  const authModal = document.getElementById('auth-modal');
  const authCloseBtn = document.getElementById('auth-modal-close-btn');
  const switchBtn = document.getElementById('auth-switch-btn');
  const primaryBtn = document.getElementById('auth-primary-btn');
  
  const usernameInput = document.getElementById('auth-username-input');
  const passwordInput = document.getElementById('auth-password-input');
  const errorMsg = document.getElementById('auth-error-msg');
  
  let isRegistering = false;
  
  badgeBtn.addEventListener('click', () => {
    if (authToken) {
      if (confirm(`Logged in as "${loggedInUser}". Would you like to sign out?`)) {
        logoutUser();
      }
    } else {
      isRegistering = false;
      toggleAuthModalMode(false);
      errorMsg.style.display = 'none';
      usernameInput.value = '';
      passwordInput.value = '';
      authModal.style.display = 'flex';
      usernameInput.focus();
    }
  });
  
  authCloseBtn.addEventListener('click', () => {
    authModal.style.display = 'none';
  });
  
  switchBtn.addEventListener('click', () => {
    isRegistering = !isRegistering;
    toggleAuthModalMode(isRegistering);
  });
  
  primaryBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      errorMsg.textContent = 'Please fill out all fields.';
      errorMsg.style.display = 'block';
      return;
    }
    
    const endpoint = isRegistering ? `${API_BASE}/api/auth/register` : `${API_BASE}/api/auth/login`;
    
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        errorMsg.textContent = data.error || 'Authentication failed.';
        errorMsg.style.display = 'block';
      } else {
        authToken = data.token;
        loggedInUser = data.username;
        library = data.library;
        
        localStorage.setItem('vibebox_token', authToken);
        localStorage.setItem('vibebox_username', loggedInUser);
        localStorage.setItem('vibebox_library', JSON.stringify(library));
        
        authModal.style.display = 'none';
        updateAuthUI();
        applySettingsAndTheme();
        renderSidebarPlaylists();
        renderHomeViewport();
        alert(`Welcome, ${loggedInUser}! Successfully signed in.`);
      }
    } catch (err) {
      errorMsg.textContent = 'Connection failed. Please try again.';
      errorMsg.style.display = 'block';
    }
  });
}

function toggleAuthModalMode(registerMode) {
  const title = document.getElementById('auth-modal-title');
  const primaryBtn = document.getElementById('auth-primary-btn');
  const switchPrompt = document.getElementById('auth-switch-prompt');
  const switchBtn = document.getElementById('auth-switch-btn');
  
  if (registerMode) {
    title.textContent = 'Create VibeBox Account';
    primaryBtn.textContent = 'Sign Up';
    switchPrompt.textContent = 'Already have an account?';
    switchBtn.textContent = 'Sign In';
  } else {
    title.textContent = 'Sign In to VibeBox';
    primaryBtn.textContent = 'Sign In';
    switchPrompt.textContent = "Don't have an account?";
    switchBtn.textContent = 'Sign Up';
  }
}

function updateAuthUI() {
  const avatar = document.getElementById('user-avatar-lbl');
  const userName = document.getElementById('user-name-lbl');
  
  if (authToken && loggedInUser) {
    avatar.textContent = loggedInUser.slice(0, 2).toUpperCase();
    userName.textContent = loggedInUser;
  } else {
    avatar.textContent = 'VB';
    userName.textContent = 'Guest User';
  }
}

function logoutUser() {
  authToken = null;
  loggedInUser = null;
  localStorage.removeItem('vibebox_token');
  localStorage.removeItem('vibebox_username');
  updateAuthUI();
  alert('Logged out successfully.');
}

// --- DISCOVER / COMMUNITY VIEW RENDERING ---
async function renderDiscoverViewport() {
  const grid = document.getElementById('discover-playlists-grid');
  grid.innerHTML = `
    <div class="search-placeholder-state">
      <svg class="placeholder-icon" viewBox="0 0 24 24" width="48" height="48" style="animation: micPulse 1.5s infinite;"><path fill="currentColor" d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 16c4.41 0 8-3.59 8-8h2c0 5.52-4.48 10-10 10z"/></svg>
      <h3>Loading shared playlists...</h3>
    </div>
  `;
  
  try {
    const res = await fetch(`${API_BASE}/api/playlists/public`);
    const data = await res.json();
    
    if (data.playlists && data.playlists.length > 0) {
      grid.innerHTML = '';
      data.playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'music-card';
        
        const gradientIndex = Math.abs(hashCode(pl._id)) % 6;
        const gradients = [
          'linear-gradient(135deg, #1e1b4b, #311042)',
          'linear-gradient(135deg, #064e3b, #022c22)',
          'linear-gradient(135deg, #4c1d95, #1e1b4b)',
          'linear-gradient(135deg, #78350f, #451a03)',
          'linear-gradient(135deg, #172554, #0f172a)',
          'linear-gradient(135deg, #581c87, #020617)'
        ];
        
        card.innerHTML = `
          <div class="card-image-wrapper">
            <div style="width:100%; height:100%; background:${gradients[gradientIndex]}; display:flex; align-items:center; justify-content:center; color:#fff;">
              <svg viewBox="0 0 24 24" width="48" height="48" opacity="0.3"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2,12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
            </div>
            <button class="card-play-btn" title="Play Playlist">
              <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
          <div class="card-title">${escapeHtml(pl.title)}</div>
          <div class="card-artist">By ${escapeHtml(pl.createdBy)} • ${pl.likes.length} Likes</div>
        `;
        
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-play-btn')) {
            e.stopPropagation();
            playAllTracklist(pl.songs);
          } else {
            openPublicPlaylistView(pl);
          }
        });
        
        grid.appendChild(card);
      });
    } else {
      grid.innerHTML = '<p class="empty-state">No public playlists shared yet. Log in and share yours!</p>';
    }
  } catch (err) {
    grid.innerHTML = '<p class="empty-state">Failed to load shared playlists.</p>';
  }
}

function openPublicPlaylistView(playlist) {
  activePlaylistId = null; // Public community context
  switchViewport('viewport-playlist');
  
  // Highlight nothing in navigation
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.playlist-link').forEach(el => el.classList.remove('active'));
  
  // Update Header details
  document.getElementById('playlist-view-title').textContent = playlist.title;
  document.getElementById('playlist-view-desc').textContent = playlist.description || 'Shared by community user.';
  document.getElementById('playlist-view-count').textContent = `Shared by ${playlist.createdBy} • ${playlist.songs.length} song${playlist.songs.length === 1 ? '' : 's'}`;
  
  // Cover gradient art
  const playlistCover = document.getElementById('playlist-view-cover');
  const gradientIndex = Math.abs(hashCode(playlist._id)) % 6;
  const gradients = [
    'linear-gradient(135deg, #1e1b4b, #311042)',
    'linear-gradient(135deg, #064e3b, #022c22)',
    'linear-gradient(135deg, #4c1d95, #1e1b4b)',
    'linear-gradient(135deg, #78350f, #451a03)',
    'linear-gradient(135deg, #172554, #0f172a)',
    'linear-gradient(135deg, #581c87, #020617)'
  ];
  playlistCover.style.background = gradients[gradientIndex];
  playlistCover.innerHTML = `<svg viewBox="0 0 24 24" width="70" height="70" opacity="0.3"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
  
  // Render public songs
  renderTracklistTable(playlist.songs, 'playlist-songs-list', 'playlist-songs-empty-state', 'public');
  
  // Configure action buttons for shared view
  const shareBtn = document.getElementById('share-playlist-btn');
  const deleteBtn = document.getElementById('delete-playlist-btn');
  const likeBtn = document.getElementById('like-playlist-btn');
  const commentsContainer = document.getElementById('playlist-comments-container');
  
  shareBtn.style.display = 'none';
  deleteBtn.style.display = 'none';
  likeBtn.style.display = 'flex';
  commentsContainer.style.display = 'block';
  
  const isLiked = authToken && playlist.likes.includes(loggedInUser);
  likeBtn.classList.toggle('active', isLiked);
  document.getElementById('like-playlist-text').textContent = `Like (${playlist.likes.length})`;
  
  likeBtn.onclick = async () => {
    if (!authToken) {
      alert('Please sign in to like community playlists.');
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/api/playlists/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ playlistId: playlist._id })
      });
      if (res.ok) {
        const data = await res.json();
        playlist.likes = data.likes;
        const nowLiked = playlist.likes.includes(loggedInUser);
        likeBtn.classList.toggle('active', nowLiked);
        document.getElementById('like-playlist-text').textContent = `Like (${playlist.likes.length})`;
      }
    } catch (err) {
      console.error(err);
    }
  };
  
  renderCommentsList(playlist.comments);
  
  // Add Comment click listener
  const postBtn = document.getElementById('submit-comment-btn');
  const commentInput = document.getElementById('playlist-comment-input');
  
  postBtn.onclick = async () => {
    if (!authToken) {
      alert('Please sign in to post comments.');
      return;
    }
    const text = commentInput.value.trim();
    if (!text) return;
    
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${playlist._id}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ text })
      });
      if (res.ok) {
        const data = await res.json();
        playlist.comments.push(data.comment);
        renderCommentsList(playlist.comments);
        commentInput.value = '';
      } else {
        alert('Failed to post comment.');
      }
    } catch (err) {
      console.error(err);
    }
  };
}

function renderCommentsList(comments) {
  const container = document.getElementById('playlist-comments-list');
  container.innerHTML = '';
  
  if (comments.length === 0) {
    container.innerHTML = `<p style="text-align:center; font-size:13px; color:var(--text-muted); padding: 12px 0;">No comments yet. Be the first to start the discussion!</p>`;
    return;
  }
  
  comments.forEach(c => {
    const card = document.createElement('div');
    card.className = 'comment-card';
    card.innerHTML = `
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(c.username)}</span>
        <span>${new Date(c.createdAt).toLocaleDateString()}</span>
      </div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
    `;
    container.appendChild(card);
  });
}

// --- RIGHT DRAWER TABS & LYRICS HANDLER ---
function setupSidebarTabs() {
  const tabQueueBtn = document.getElementById('tab-queue-btn');
  const tabLyricsBtn = document.getElementById('tab-lyrics-btn');
  const queueContent = document.getElementById('sidebar-queue-content');
  const lyricsContent = document.getElementById('sidebar-lyrics-content');
  
  tabQueueBtn.addEventListener('click', () => {
    tabQueueBtn.classList.add('active');
    tabLyricsBtn.classList.remove('active');
    tabQueueBtn.style.color = 'var(--text-main)';
    tabLyricsBtn.style.color = 'var(--text-muted)';
    queueContent.style.display = 'flex';
    lyricsContent.style.display = 'none';
  });
  
  tabLyricsBtn.addEventListener('click', () => {
    tabLyricsBtn.classList.add('active');
    tabQueueBtn.classList.remove('active');
    tabLyricsBtn.style.color = 'var(--text-main)';
    tabQueueBtn.style.color = 'var(--text-muted)';
    queueContent.style.display = 'none';
    lyricsContent.style.display = 'flex';
  });
}

async function fetchActiveTrackLyrics() {
  const current = getActiveTrack();
  
  const loadingDiv = document.getElementById('lyrics-loading');
  const emptyDiv = document.getElementById('lyrics-empty');
  const textDiv = document.getElementById('lyrics-text');
  const missingBox = document.getElementById('lyrics-missing-form');
  
  if (!current) {
    emptyDiv.style.display = 'block';
    loadingDiv.style.display = 'none';
    textDiv.style.display = 'none';
    missingBox.style.display = 'none';
    return;
  }
  
  emptyDiv.style.display = 'none';
  loadingDiv.style.display = 'block';
  textDiv.style.display = 'none';
  missingBox.style.display = 'none';
  
  let artist = current.artist;
  let title = current.title;
  
  // Format parsing checks
  if (artist === 'Unknown Artist' || artist.toLowerCase().includes('topic')) {
    const parts = current.title.split(' - ');
    if (parts.length === 2) {
      artist = parts[0].trim();
      title = parts[1].trim();
    }
  }
  
  // Clean titles from suffixes
  title = title.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
  
  try {
    const res = await fetch(`${API_BASE}/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);
    const data = await res.json();
    loadingDiv.style.display = 'none';
    
    if (data.lyrics) {
      textDiv.textContent = data.lyrics;
      textDiv.style.display = 'block';
      missingBox.style.display = 'none';
    } else {
      textDiv.style.display = 'none';
      missingBox.style.display = 'block';
      
      const submitBtn = document.getElementById('submit-lyrics-btn');
      const textInput = document.getElementById('submit-lyrics-input');
      textInput.value = '';
      
      submitBtn.onclick = async () => {
        if (!authToken) {
          alert('Please sign in to submit lyrics.');
          return;
        }
        const lyricsText = textInput.value.trim();
        if (!lyricsText) return;
        
        try {
          const postRes = await fetch(`${API_BASE}/api/lyrics/submit`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ artist, title, lyrics: lyricsText })
          });
          if (postRes.ok) {
            const postData = await postRes.json();
            if (postData) {
              textDiv.textContent = postData.lyrics;
              textDiv.style.display = 'block';
              missingBox.style.display = 'none';
            }
          } else {
            alert('Failed to submit lyrics.');
          }
        } catch (e) {
          console.error(e);
        }
      };
    }
  } catch (err) {
    loadingDiv.style.display = 'none';
    emptyDiv.style.display = 'block';
    emptyDiv.textContent = 'Error loading lyrics.';
  }
}

// --- VOICE SEARCH (SPEECH-TO-TEXT) ---
function setupVoiceSearch() {
  const voiceBtn = document.getElementById('voice-search-btn');
  const searchInput = document.getElementById('global-search-input');
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.style.display = 'none';
    return;
  }
  
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  
  voiceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (voiceBtn.classList.contains('recording')) {
      recognition.stop();
    } else {
      voiceBtn.classList.add('recording');
      voiceBtn.title = 'Listening... Speak now';
      recognition.start();
    }
  });
  
  recognition.addEventListener('result', (e) => {
    const transcript = e.results[0][0].transcript;
    searchInput.value = transcript;
    
    // Switch to search view and trigger query search
    switchViewport('viewport-search');
    triggerSearch(transcript);
  });
  
  recognition.addEventListener('end', () => {
    voiceBtn.classList.remove('recording');
    voiceBtn.title = 'Search with your voice';
  });
  
  recognition.addEventListener('error', () => {
    voiceBtn.classList.remove('recording');
    voiceBtn.title = 'Search with your voice';
  });
}

// --- ACCESSIBILITY KEYBOARD CONTROLS ---
function setupAccessibilityShortcuts() {
  const helpBtn = document.getElementById('shortcuts-help-btn');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const shortcutsCloseBtn = document.getElementById('shortcuts-modal-close-btn');
  const gotItBtn = document.getElementById('shortcuts-close-btn');
  
  const toggleHelp = () => {
    const isVisible = shortcutsModal.style.display === 'flex';
    shortcutsModal.style.display = isVisible ? 'none' : 'flex';
  };
  
  helpBtn.addEventListener('click', toggleHelp);
  shortcutsCloseBtn.addEventListener('click', () => { shortcutsModal.style.display = 'none'; });
  gotItBtn.addEventListener('click', () => { shortcutsModal.style.display = 'none'; });
  
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    
    switch (e.key) {
      case 'm':
      case 'M':
        e.preventDefault();
        document.getElementById('ctrl-mute').click();
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        const activeTrack = getActiveTrack();
        if (activeTrack) {
          toggleLikeSong(activeTrack);
          updatePlaybackUI();
          if (document.querySelector('.viewport.active').id === 'viewport-liked') {
            renderLikedSongsViewport();
          }
        }
        break;
      case '?':
        e.preventDefault();
        toggleHelp();
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustVolume(5);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustVolume(-5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekRelative(10);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekRelative(-10);
        break;
    }
  });
}

function adjustVolume(amount) {
  const slider = document.getElementById('volume-slider');
  let val = parseInt(slider.value) + amount;
  val = Math.max(0, Math.min(100, val));
  
  slider.value = val;
  document.getElementById('volume-progress').style.width = val + '%';
  if (playback.player) {
    playback.player.setVolume(val);
    playback.player.unMute();
  }
  localStorage.setItem('vibebox_volume', val);
  updateVolumeIconState(val, false);
}

function seekRelative(seconds) {
  if (!playback.player) return;
  const current = playback.player.getCurrentTime() || 0;
  const duration = playback.player.getDuration() || 0;
  let target = current + seconds;
  target = Math.max(0, Math.min(duration, target));
  
  playback.player.seekTo(target, true);
  if (duration > 0) {
    const pct = (target / duration) * 100;
    document.getElementById('timeline-slider').value = pct;
    document.getElementById('timeline-progress').style.width = pct + '%';
    document.getElementById('time-current').textContent = formatSeconds(target);
  }
}

// --- DYNAMIC HEADER GRADIENT BACKDROP & COLOR EXTRACTORS ---
function extractDominantColor(imageUrl, callback) {
  if (!imageUrl) {
    callback('#2a2a2a');
    return;
  }
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.onload = function() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 10, 10);
      const imgData = ctx.getImageData(0, 0, 10, 10).data;
      
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        const alpha = imgData[i + 3];
        if (alpha < 200) continue;
        
        r += imgData[i];
        g += imgData[i + 1];
        b += imgData[i + 2];
        count++;
      }
      
      if (count === 0) {
        callback('#2a2a2a');
        return;
      }
      
      r = Math.floor(r / count);
      g = Math.floor(g / count);
      b = Math.floor(b / count);
      
      // Keep color rich but dark to contrast text nicely
      const maxVal = Math.max(r, g, b);
      if (maxVal > 150) {
        const factor = 150 / maxVal;
        r = Math.floor(r * factor);
        g = Math.floor(g * factor);
        b = Math.floor(b * factor);
      }
      
      const minVal = r + g + b;
      if (minVal < 100) {
        r = Math.min(110, r + 30);
        g = Math.min(110, g + 30);
        b = Math.min(110, b + 30);
      }
      
      callback(`rgb(${r}, ${g}, ${b})`);
    } catch (err) {
      callback('#2a2a2a');
    }
  };
  img.onerror = function() {
    callback('#2a2a2a');
  };
  img.src = imageUrl;
}

function updateDynamicHeaderGradient(song) {
  const headerGradient = document.getElementById('main-gradient-header');
  if (!headerGradient) return;
  
  if (!song) {
    headerGradient.style.setProperty('--gradient-color', '#2a2a2a');
    return;
  }
  
  // Custom hash fallback
  const hash = hashCode(song.title + song.artist);
  const hue = Math.abs(hash) % 360;
  const fallbackColor = `hsl(${hue}, 45%, 18%)`;
  
  extractDominantColor(song.thumbnail, (color) => {
    const finalColor = color === '#2a2a2a' ? fallbackColor : color;
    headerGradient.style.setProperty('--gradient-color', finalColor);
  });
}
