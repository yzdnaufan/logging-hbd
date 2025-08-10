// server.js
const express = require('express');
const cors = require('cors');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Method 1: Using Firebase Config with Service Account Key
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
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

// Alternative Method 2: Using Application Default Credentials (for Google Cloud deployment)
// initializeApp({
//   credential: admin.credential.applicationDefault(),
//   projectId: firebaseConfig.projectId
// });

// Alternative Method 3: Using service account key file
// const serviceAccount = require('./path/to/serviceAccountKey.json');
// initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

const db = getFirestore();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://localhost:3000',
    'https://localhost:5173', // HTTPS localhost
    /^https:\/\/.*\.netlify\.app$/, // Any Netlify domain
    /^https:\/\/.*\.vercel\.app$/, // Any Vercel domain
    // Add your specific domains
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json());

// Helper function to get client IP
const getClientIP = (req) => {
  // Get the forwarded IP first (for production behind proxies)
  let ip = req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           (req.connection?.socket ? req.connection.socket.remoteAddress : null) ||
           req.ip;

  // Handle IPv6 localhost
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    // In development, try to get a more meaningful IP
    const networkInterfaces = require('os').networkInterfaces();
    
    // Get the first non-internal IPv4 address
    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          ip = `${net.address} (local-dev)`;
          break;
        }
      }
      if (ip !== '::1' && ip !== '::ffff:127.0.0.1') break;
    }
    
    // If still localhost, mark it clearly
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = 'localhost-dev';
    }
  }

  // Clean up IPv6-mapped IPv4 addresses
  if (ip && ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  return ip || 'unknown';
};

// Multiple routes with different names to avoid ad blockers
const handleVisitorLog = async (req, res) => {
  try {
    const { fingerprint, userAgent, referrer, screenResolution, timezone } = req.body;
    const clientIP = getClientIP(req);
    const timestamp = new Date();

    // Helper function to remove undefined values
    const cleanObject = (obj) => {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && value !== null && value !== '') {
          if (typeof value === 'object' && !Array.isArray(value)) {
            const cleanedNested = cleanObject(value);
            if (Object.keys(cleanedNested).length > 0) {
              cleaned[key] = cleanedNested;
            }
          } else {
            cleaned[key] = value;
          }
        }
      }
      return cleaned;
    };

    // Prepare visitor data with cleaned values
    const visitorData = cleanObject({
      ip: clientIP,
      fingerprint: fingerprint,
      userAgent: userAgent || req.headers['user-agent'],
      referrer: referrer || req.headers.referer,
      screenResolution: screenResolution,
      timezone: timezone,
      timestamp: timestamp,
      url: req.body.url,
      headers: {
        'accept-language': req.headers['accept-language'],
        'accept-encoding': req.headers['accept-encoding'],
        'connection': req.headers.connection,
        'host': req.headers.host,
        'origin': req.headers.origin
      }
    });

    console.log('Cleaned visitor data:', JSON.stringify(visitorData, null, 2));

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
      message: 'Failed to log visit',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Route to log visitor data (multiple endpoints to avoid ad blockers)
app.post('/api/activity', handleVisitorLog);
app.post('/api/data', handleVisitorLog);
app.post('/api/info', handleVisitorLog);

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