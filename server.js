const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch'); // npm install node-fetch@2
const app = express();

const serviceAccount = JSON.parse(process.env.SERVICEACCOUNTKEY);
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// Store the last entry ID to track new data
let lastEntryId = null;

// Function to fetch latest ThingSpeak data
async function fetchLatestThingSpeak(channelId, readApiKey) {
  const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?api_key=${readApiKey}&results=1`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data && data.feeds && data.feeds.length) {
    const latestFeed = data.feeds[0];
    const entryId = latestFeed.entry_id;
    const latitude = Number(latestFeed.field7);
    const longitude = Number(latestFeed.field8);
    
    return { 
      entryId, 
      latitude, 
      longitude,
      createdAt: latestFeed.created_at 
    };
  }
  throw new Error('No data found in ThingSpeak channel');
}

// Check for new data and update Firebase only if data is new
async function checkAndUpdateFirebase() {
  try {
    const channelId = '3052335';        // Replace with your channel ID
    const readApiKey = 'PH1AC0E950KHP14J';     // Remove if channel is public
    
    const { entryId, latitude, longitude, createdAt } = await fetchLatestThingSpeak(channelId, readApiKey);
    
    // Check if this is new data
    if (lastEntryId === null) {
      // First run - initialize lastEntryId
      lastEntryId = entryId;
      console.log(`Initialized with entry ID: ${entryId}`);
    } else if (entryId === lastEntryId) {
      // No new data
      console.log(`No new data. Current entry ID: ${entryId}`);
      return;
    }
    
    // New data found
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
      year: 'numeric'
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
      
      // Update our tracking variable
      lastEntryId = entryId;
    } else {
      console.warn('Invalid lat/lng fetched from ThingSpeak');
    }
  } catch (error) {
    console.error('Error checking ThingSpeak or updating Firebase:', error);
  }
}

// Alternative approach: Using ThingSpeak's timestamp to detect changes
async function checkAndUpdateFirebaseByTimestamp() {
  try {
    const channelId = '3052335';
    const readApiKey = 'PH1AC0E950KHP14J';
    
    const { entryId, latitude, longitude, createdAt } = await fetchLatestThingSpeak(channelId, readApiKey);
    
    // Get the last timestamp from Firebase
    const snapshot = await db.ref('HomeFragment/thingSpeakTimestamp').once('value');
    const lastTimestamp = snapshot.val();
    
    if (lastTimestamp && createdAt === lastTimestamp) {
      console.log('No new data based on timestamp comparison');
      return;
    }
    
    console.log(`New data detected! Timestamp: ${createdAt}`);
    console.log(`Fetched coordinates: ${latitude}, ${longitude}`);
    
    const now = new Date();
    const formattedTime = now.toLocaleString('en-IN', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    if (!isNaN(latitude) && !isNaN(longitude)) {
      await db.ref('HomeFragment').update({
        Latitude: latitude,
        Longitude: longitude,
        updatedAt: formattedTime,
        thingSpeakEntryId: entryId,
        thingSpeakTimestamp: createdAt
      });
      
      console.log(`✅ Firebase updated with new ThingSpeak data`);
    } else {
      console.warn('Invalid lat/lng fetched from ThingSpeak');
    }
  } catch (error) {
    console.error('Error checking ThingSpeak or updating Firebase:', error);
  }
}

// Start checking for new data every 30 seconds (you can adjust this interval)
// The key difference is that Firebase only gets updated when there's actually new data
const CHECK_INTERVAL = 30000; // 30 seconds - adjust as needed
setInterval(checkAndUpdateFirebase, CHECK_INTERVAL);

// Alternative: Use the timestamp-based approach
// setInterval(checkAndUpdateFirebaseByTimestamp, CHECK_INTERVAL);

// Initialize on startup
checkAndUpdateFirebase();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running and checking ThingSpeak for new data every ${CHECK_INTERVAL/1000} seconds on port ${PORT}`);
});
