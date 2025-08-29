const express = require('express');
const admin = require('firebase-admin');
const app = express();

app.use(express.json()); // to parse JSON body

admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccountKey.json')),
  databaseURL: "https://telematics81-default-rtdb.firebaseio.com/"
});

const db = admin.database();

app.post('/thingspeak-webhook', async (req, res) => {
  try {
    const { field1, field2 } = req.body; // ThingSpeak sends data here
    
    if (field1 && field2) {
      await db.ref('HomeFragment').set({
        Latitude: field1,
        Longitude: field2,
        updatedAt: Date.now()
      });
      console.log('Firebase updated from webhook:', field1, field2);
      res.status(200).send('Firebase updated');
    } else {
      res.status(400).send('Missing fields');
    }
  } catch (error) {
    console.error('Error updating Firebase:', error);
    res.status(500).send('Internal server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
