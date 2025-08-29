const express = require('express');
const admin = require('firebase-admin');
const app = express();
const serviceAccount = JSON.parse(process.env.SERVICEACCOUNTKEY);

app.use(express.json()); // to parse JSON body

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

app.post('/thingspeak-webhook', async (req, res) => {
  try {
    let { field1, field2 } = req.body;

    // Convert fields to numbers explicitly
    const latitude = Number(field1);
    const longitude = Number(field2);

    if (!isNaN(latitude) && !isNaN(longitude)) {
      await db.ref('HomeFragment').update({
        Latitude: latitude,
        Longitude: longitude,
        updatedAt: Date.now()
      });
      console.log('Firebase updated from webhook:', latitude, longitude);
      res.status(200).send('Firebase updated');
    } else {
      res.status(400).send('Invalid latitude or longitude');
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
