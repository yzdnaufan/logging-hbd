// server.js
const express = require('express');
const cors = require('cors');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Debug environment variables (remove in production)
console.log('Checking environment variables:');
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'Set' : 'Missing');
console.log('FIREBASE_PRIVATE_KEY_ID:', process.env.FIREBASE_PRIVATE_KEY_ID ? 'Set' : 'Missing');
console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'Set' : 'Missing');
console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'Missing');
console.log('FIREBASE_CLIENT_ID:', process.env.FIREBASE_CLIENT_ID ? 'Set' : 'Missing');

// Method 1: Using Firebase Config with Service Account Key
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Validate required environment variables
const requiredEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_CLIENT_ID'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Initialize Firebase Admin with service account credentials
const serviceAccountCredentials = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  // Fix private key formatting - remove quotes and handle newlines properly
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, '\n')
    ?.replace(/^"(.*)"$/, '$1'), // Remove surrounding quotes if present
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

// Validate credentials format
if (!serviceAccountCredentials.private_key.includes('-----BEGIN PRIVATE KEY-----')) {
  console.error('Private key format appears invalid. Make sure it includes the full key with headers.');
  console.error('Private key should start with: -----BEGIN PRIVATE KEY-----');
  process.exit(1);
}

try {
  // Initialize Firebase Admin
  console.log('Initializing Firebase Admin...');
  initializeApp({
    credential: admin.credential.cert(serviceAccountCredentials),
    projectId: firebaseConfig.projectId
  });
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error.message);
  console.error('Full error:', error);
  process.exit(1);
}

let db;
try {
  db = getFirestore();
  console.log('Firestore initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firestore:', error.message);
  process.exit(1);
}

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://localhost:5173'
    ];
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Check if origin matches Netlify pattern
    if (origin.match(/^https:\/\/.*\.netlify\.app$/)) {
      return callback(null, true);
    }
    
    // Check if origin matches Vercel pattern
    if (origin.match(/^https:\/\/.*\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    // If none of the above, reject the request
    const msg = `The CORS policy for this origin doesn't allow access from the particular origin: ${origin}`;
    return callback(new Error(msg), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight requests explicitly
// app.options('/*', cors());

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
// Simple approach - just remove undefined values
const handleVisitorLog = async (req, res) => {
  try {
    const { fingerprint, userAgent, referrer, screenResolution, timezone, url } = req.body;
    const clientIP = getClientIP(req);
    const timestamp = new Date();

    // Prepare visitor data - only include defined values
    const visitorData = {
      ip: clientIP || 'unknown',
      timestamp: timestamp
    };

    // Add optional fields only if they have values
    if (fingerprint) visitorData.fingerprint = fingerprint;
    if (userAgent || req.headers['user-agent']) {
      visitorData.userAgent = userAgent || req.headers['user-agent'];
    }
    if (referrer || req.headers.referer) {
      visitorData.referrer = referrer || req.headers.referer;
    }
    if (screenResolution) visitorData.screenResolution = screenResolution;
    if (timezone) visitorData.timezone = timezone;
    if (url) visitorData.url = url;

    // Add headers that exist
    const headers = {};
    if (req.headers['accept-language']) headers['accept-language'] = req.headers['accept-language'];
    if (req.headers['accept-encoding']) headers['accept-encoding'] = req.headers['accept-encoding'];
    if (req.headers.connection) headers.connection = req.headers.connection;
    if (req.headers.host) headers.host = req.headers.host;
    if (req.headers.origin) headers.origin = req.headers.origin;
    
    if (Object.keys(headers).length > 0) {
      visitorData.headers = headers;
    }

    console.log('Saving visitor data:', JSON.stringify(visitorData, null, 2));

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
      uniqueDevices: new Set(snapshot.docs.map(doc => doc.data().fingerprint)).size,
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