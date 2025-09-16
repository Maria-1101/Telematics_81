const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch'); // npm install node-fetch@2
const app = express();

// Add memory monitoring
const formatBytes = (bytes) => {
  return Math.round(bytes / 1024 / 1024 * 100) / 100 + ' MB';
};

const logMemoryUsage = () => {
  const usage = process.memoryUsage();
  console.log(`Memory Usage - RSS: ${formatBytes(usage.rss)}, Heap Used: ${formatBytes(usage.heapUsed)}, Heap Total: ${formatBytes(usage.heapTotal)}`);
};

// Log memory usage every 5 minutes
setInterval(logMemoryUsage, 5 * 60 * 1000);

const serviceAccount = JSON.parse(process.env.SERVICEACCOUNTKEY);
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// Store the last entry ID to track new data
let lastEntryId = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// Add error handling and recovery
async function fetchLatestThingSpeak(channelId, readApiKey) {
  try {
    const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?api_key=${readApiKey}&results=1`;
    
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`ThingSpeak API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data && data.feeds && data.feeds.length) {
      const latestFeed = data.feeds[0];
      const entryId = latestFeed.entry_id;
      const latitude = Number(latestFeed.field8);
      const longitude = Number(latestFeed.field7);
      
      return { 
        entryId, 
        latitude, 
        longitude,
        createdAt: latestFeed.created_at 
      };
    }
    throw new Error('No data found in ThingSpeak channel');
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

// Enhanced error handling with exponential backoff
async function checkAndUpdateFirebase() {
  try {
    const channelId = '3052335';
    const readApiKey = 'PH1AC0E950KHP14J';
    
    const { entryId, latitude, longitude, createdAt } = await fetchLatestThingSpeak(channelId, readApiKey);
    
    // Reset error counter on successful fetch
    consecutiveErrors = 0;
    
    if (lastEntryId === null) {
      lastEntryId = entryId;
      console.log(`Initialized with entry ID: ${entryId}`);
    } else if (entryId === lastEntryId) {
      console.log(`No new data. Current entry ID: ${entryId}`);
      return;
    }
    
    console.log(`New data detected! Entry ID changed from ${lastEntryId} to ${entryId}`);
    console.log(`Fetched coordinates: ${latitude}, ${longitude}`);
    
    const now = new Date();
    const formattedTime = now.toLocaleString('en-IN', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
    
    if (!isNaN(latitude) && !isNaN(longitude)) {
      await db.ref('HomeFragment').update({
        Latitude: latitude,
        Longitude: longitude,
        updatedAt: formattedTime,
        thingSpeakEntryId: entryId,
        thingSpeakTimestamp: createdAt
      });
      
      console.log(`✅ Firebase updated with new ThingSpeak data (Entry ID: ${entryId})`);
      lastEntryId = entryId;
    } else {
      console.warn('Invalid lat/lng fetched from ThingSpeak');
    }
  } catch (error) {
    consecutiveErrors++;
    console.error(`Error ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);
    
    // If too many consecutive errors, increase check interval temporarily
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error('⚠️  Too many consecutive errors. Something might be wrong.');
      // You could implement exponential backoff here
    }
    
    // Log memory usage when errors occur
    logMemoryUsage();
  }
}

// Add health check endpoint
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  
  res.json({
    status: 'OK',
    uptime: `${Math.floor(uptime / 60)} minutes`,
    memory: {
      rss: formatBytes(memUsage.rss),
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal)
    },
    lastEntryId,
    consecutiveErrors,
    timestamp: new Date().toISOString()
  });
});

// Add graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const CHECK_INTERVAL = 15000; // 30 seconds
const intervalId = setInterval(checkAndUpdateFirebase, CHECK_INTERVAL);

// Initialize on startup
checkAndUpdateFirebase();

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔄 Checking ThingSpeak every ${CHECK_INTERVAL/1000} seconds`);
  console.log(`💾 Initial memory usage:`);
  logMemoryUsage();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  clearInterval(intervalId);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
