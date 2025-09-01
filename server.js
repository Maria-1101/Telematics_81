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

// Function to fetch latest ThingSpeak data
async function fetchLatestThingSpeak(channelId, readApiKey) {
  const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?api_key=${readApiKey}&results=1`;
  const response = await fetch(url);
  const data = await response.json();

  if (data && data.feeds && data.feeds.length) {
    const latestFeed = data.feeds[0];
    const latitude = Number(latestFeed.field7);
    const longitude = Number(latestFeed.field8);
    return { latitude, longitude };
  }
  throw new Error('No data found in ThingSpeak channel');
}

// Poll ThingSpeak every 1 minute to update Firebase
async function pollAndUpdateFirebase() {
  try {
    const channelId = '3052335';        // Replace with your channel ID
    const readApiKey = 'PH1AC0E950KHP14J';     // Remove if channel is public

    const { latitude, longitude } = await fetchLatestThingSpeak(channelId, readApiKey);
    console.log(`Fetched coordinates: ${latitude}, ${longitude}`);

    if (!isNaN(latitude) && !isNaN(longitude)) {
      await db.ref('HomeFragment').update({
        Latitude: latitude,
        Longitude: longitude,
        updatedAt: Date.now()
      });
      console.log('Firebase updated with latest ThingSpeak data');
    } else {
      console.warn('Invalid lat/lng fetched from ThingSpeak');
    }
  } catch (error) {
    console.error('Error polling ThingSpeak or updating Firebase:', error);
  }
}

// Start polling loop
setInterval(pollAndUpdateFirebase, 15000); // every 60 seconds

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running and polling ThingSpeak on port ${PORT}`);
});
