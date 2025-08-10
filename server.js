const express = require('express');

const cors = require('cors');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;


// Method 1: Using Firebase Config with Service Account Key
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase Admin with service account credentials
const serviceAccountCredentials = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Handle escaped newlines
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

// Initialize Firebase Admin
initializeApp({
  credential: admin.credential.cert(serviceAccountCredentials),
  projectId: firebaseConfig.projectId
});

const db = getFirestore();


// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', "https://sensational-madeleine-e002bb.netlify.app/"], // Add your Vite dev server and production URLs
  credentials: true
}));

app.use(express.json());

// Helper function to get client IP
const getClientIP = (req) => {
  return req.headers['x-forwarded-for'] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         req.ip;
};

// Route to log visitor data (renamed to avoid ad blockers)
app.post('/api/activity', async (req, res) => {
  try {
    const { fingerprint, userAgent, referrer, screenResolution, timezone } = req.body;
    const clientIP = getClientIP(req);
    const timestamp = new Date();

    // Prepare visitor data
    const visitorData = {
      ip: clientIP,
      fingerprint: fingerprint || null,
      userAgent: userAgent || req.headers['user-agent'],
      referrer: referrer || req.headers.referer,
      screenResolution: screenResolution || null,
      timezone: timezone || null,
      timestamp: timestamp,
      headers: {
        'accept-language': req.headers['accept-language'],
        'accept-encoding': req.headers['accept-encoding'],
        'connection': req.headers.connection
      }
    };

    // Save to Firestore
    const docRef = await db.collection('visitors').add(visitorData);
    
    console.log(`New visitor logged: ${docRef.id} from IP: ${clientIP}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Visit logged successfully',
      visitId: docRef.id 
    });

  } catch (error) {
    console.error('Error logging visit:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to log visit' 
    });
  }
});

// Route to get visitor statistics (optional)
app.get('/api/visitor-stats', async (req, res) => {
  try {
    const visitorsRef = db.collection('visitors');
    const snapshot = await visitorsRef.get();
    
    const stats = {
      totalVisits: snapshot.size,
      uniqueIPs: new Set(snapshot.docs.map(doc => doc.data().ip)).size,
      recentVisits: snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
