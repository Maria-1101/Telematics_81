const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch'); // npm install node-fetch@2
const app = express();

// ✅ PRODUCTION CONFIG
const CONFIG = {
  CHECK_INTERVAL: parseInt(process.env.CHECK_INTERVAL) || 15000,
  MAX_CONSECUTIVE_ERRORS: 5,
  REQUEST_TIMEOUT: 15000,
  MAX_MEMORY_MB: 400,
  RETRY_DELAY: 5000
};

// ✅ MEMORY MONITORING
const formatBytes = (bytes) => {
  return Math.round(bytes / 1024 / 1024 * 100) / 100 + ' MB';
};

const logMemoryUsage = () => {
  const usage = process.memoryUsage();
  const rssMemoryMB = Math.round(usage.rss / 1024 / 1024);
  
  console.log(`Memory Usage - RSS: ${formatBytes(usage.rss)}, Heap Used: ${formatBytes(usage.heapUsed)}, Heap Total: ${formatBytes(usage.heapTotal)}`);
  
  // ✅ Alert on high memory usage
  if (rssMemoryMB > CONFIG.MAX_MEMORY_MB) {
    console.warn(`⚠️ HIGH MEMORY USAGE: ${rssMemoryMB}MB (limit: ${CONFIG.MAX_MEMORY_MB}MB)`);
  }
  
  return rssMemoryMB;
};

// ✅ VALIDATE ENVIRONMENT VARIABLES ON STARTUP
function validateEnvironment() {
  const required = ['SERVICEACCOUNTKEY', 'FIREBASE_DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set these in your Render dashboard');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
}

validateEnvironment();

// ✅ INITIALIZE FIREBASE WITH ERROR HANDLING
let db;
try {
  const serviceAccount = JSON.parse(process.env.SERVICEACCOUNTKEY);
  app.use(express.json());

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });

  db = admin.database();
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  console.error('Check your SERVICEACCOUNTKEY format');
  process.exit(1);
}

// ✅ APPLICATION STATE
let lastEntryId = null;
let consecutiveErrors = 0;
let globalErrorCount = 0;
let lastSuccessTime = new Date();
let isShuttingDown = false;
let currentInterval = CONFIG.CHECK_INTERVAL;

// ✅ INTERVAL VARIABLES (Declare at top level for proper cleanup)
let mainIntervalId;
let memoryInterval;
let keepAliveInterval;

// ✅ KEEP-ALIVE MECHANISM
const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000; // 10 minutes

async function keepAlive() {
  if (isShuttingDown) return;
  
  try {
    const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
    console.log('🏃 Keep-alive ping...');
    
    const response = await fetch(`${appUrl}/health`, {
      timeout: 5000,
      headers: { 'User-Agent': 'KeepAlive-Internal' }
    });
    
    if (response.ok) {
      console.log('✅ Keep-alive successful');
    }
  } catch (error) {
    console.log('⚠️ Keep-alive failed (not critical):', error.message);
  }
}

// ✅ EXPONENTIAL BACKOFF IMPLEMENTATION
function calculateBackoffDelay() {
  if (consecutiveErrors <= 2) return CONFIG.CHECK_INTERVAL;
  
  // Exponential backoff: 15s, 30s, 60s, 120s, max 300s
  const backoffMultiplier = Math.min(Math.pow(2, consecutiveErrors - 2), 20);
  return Math.min(CONFIG.CHECK_INTERVAL * backoffMultiplier, 300000);
}

// ✅ ROBUST THINGSPEAK FETCH WITH RETRY LOGIC
async function fetchLatestThingSpeak(channelId, readApiKey, retryAttempt = 0) {
  const maxRetries = 3;
  
  try {
    const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?api_key=${readApiKey}&results=1`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Telematics-Service/1.0',
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`ThingSpeak API error: ${response.status} ${response.statusText}`);
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
      error.message = 'Request timeout - ThingSpeak API too slow';
    }
    
    // ✅ RETRY LOGIC
    if (retryAttempt < maxRetries) {
      const retryDelay = CONFIG.RETRY_DELAY * (retryAttempt + 1);
      console.warn(`Retry ${retryAttempt + 1}/${maxRetries} after ${retryDelay}ms: ${error.message}`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return fetchLatestThingSpeak(channelId, readApiKey, retryAttempt + 1);
    }
    
    throw error;
  }
}

// ✅ MAIN APPLICATION LOGIC WITH RECOVERY
async function checkAndUpdateFirebase() {
  if (isShuttingDown) {
    console.log('⏹️ Skipping check - application is shutting down');
    return;
  }

  try {
    const channelId = '3052335';
    const readApiKey = 'PH1AC0E950KHP14J';
    
    console.log(`🔍 Checking ThingSpeak... (Errors: ${consecutiveErrors}/${CONFIG.MAX_CONSECUTIVE_ERRORS})`);
    
    const { entryId, latitude, longitude, createdAt } = await fetchLatestThingSpeak(channelId, readApiKey);
    
    // ✅ SUCCESS - RESET ERROR COUNTERS
    consecutiveErrors = 0;
    globalErrorCount = Math.max(0, globalErrorCount - 1);
    lastSuccessTime = new Date();
    currentInterval = CONFIG.CHECK_INTERVAL; // Reset to normal interval
    
    if (lastEntryId === null) {
      lastEntryId = entryId;
      console.log(`🎯 Initialized with entry ID: ${entryId}`);
      return;
    }
    
    if (entryId === lastEntryId) {
      console.log(`✓ No new data (Entry ID: ${entryId})`);
      return;
    }
    
    // ✅ VALIDATE COORDINATES
    if (isNaN(latitude) || isNaN(longitude) || latitude === 0 || longitude === 0) {
      console.warn(`⚠️ Invalid coordinates: lat=${latitude}, lng=${longitude}`);
      return;
    }
    
    console.log(`🆕 NEW DATA! Entry ID: ${lastEntryId} → ${entryId}`);
    console.log(`📍 Location: ${latitude}, ${longitude}`);
    
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
    
    // ✅ UPDATE FIREBASE WITH RETRY
    await updateFirebaseWithRetry({
      Latitude: latitude,
      Longitude: longitude,
      updatedAt: formattedTime,
      thingSpeakEntryId: entryId,
      thingSpeakTimestamp: createdAt
    });
    
    lastEntryId = entryId;
    console.log(`✅ Firebase updated successfully at ${formattedTime}`);
    
  } catch (error) {
    consecutiveErrors++;
    globalErrorCount++;
    
    console.error(`❌ Error ${consecutiveErrors}/${CONFIG.MAX_CONSECUTIVE_ERRORS}: ${error.message}`);
    
    // ✅ IMPLEMENT EXPONENTIAL BACKOFF
    if (consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
      currentInterval = calculateBackoffDelay();
      console.warn(`🐌 Too many errors - backing off to ${currentInterval/1000}s interval`);
    }
    
    // ✅ LOG MEMORY ON ERRORS
    const memoryUsage = logMemoryUsage();
    
    // ✅ DON'T CRASH - JUST LOG AND CONTINUE
    console.log(`🔄 Will retry in ${currentInterval/1000} seconds...`);
  }
}

// ✅ FIREBASE UPDATE WITH RETRY
async function updateFirebaseWithRetry(data, retryAttempt = 0) {
  const maxRetries = 3;
  
  try {
    await db.ref('HomeFragment/UserID1').update(data);
  } catch (error) {
    if (retryAttempt < maxRetries) {
      const retryDelay = 2000 * (retryAttempt + 1);
      console.warn(`Firebase retry ${retryAttempt + 1}/${maxRetries} after ${retryDelay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return updateFirebaseWithRetry(data, retryAttempt + 1);
    }
    throw error;
  }
}

// ✅ COMPREHENSIVE HEALTH CHECK
app.get('/health', (req, res) => {
  const uptime = Math.floor(process.uptime());
  const memUsage = process.memoryUsage();
  const timeSinceLastSuccess = Math.floor((new Date() - lastSuccessTime) / 1000);
  
  const isHealthy = consecutiveErrors < CONFIG.MAX_CONSECUTIVE_ERRORS && timeSinceLastSuccess < 300; // 5 minutes
  
  const healthData = {
    status: isHealthy ? 'healthy' : 'degraded',
    uptime: {
      seconds: uptime,
      formatted: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`
    },
    memory: {
      rss: formatBytes(memUsage.rss),
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal)
    },
    errors: {
      consecutive: consecutiveErrors,
      total: globalErrorCount,
      maxAllowed: CONFIG.MAX_CONSECUTIVE_ERRORS
    },
    data: {
      lastEntryId,
      lastSuccessTime: lastSuccessTime.toISOString(),
      timeSinceLastSuccess: `${timeSinceLastSuccess}s ago`
    },
    intervals: {
      configured: `${CONFIG.CHECK_INTERVAL/1000}s`,
      current: `${currentInterval/1000}s`
    },
    timestamp: new Date().toISOString()
  };
  
  const statusCode = isHealthy ? 200 : 503;
  res.status(statusCode).json(healthData);
});

// ✅ STATUS PAGE
app.get('/', (req, res) => {
  const uptime = Math.floor(process.uptime());
  const isHealthy = consecutiveErrors < CONFIG.MAX_CONSECUTIVE_ERRORS;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Telematics Service</title>
      <meta http-equiv="refresh" content="30">
      <style>
        body { font-family: Arial; margin: 40px; background: #f0f2f5; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .status { padding: 15px; border-radius: 8px; margin: 15px 0; font-weight: bold; }
        .healthy { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .degraded { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .metric { margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚗 Telematics Tracking Service</h1>
        <div class="status ${isHealthy ? 'healthy' : 'degraded'}">
          ${isHealthy ? '✅ Service is running normally' : '⚠️ Service is experiencing issues'}
        </div>
        
        <div class="metric"><strong>Uptime:</strong> ${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s</div>
        <div class="metric"><strong>Check Interval:</strong> ${currentInterval/1000} seconds</div>
        <div class="metric"><strong>Consecutive Errors:</strong> ${consecutiveErrors}/${CONFIG.MAX_CONSECUTIVE_ERRORS}</div>
        <div class="metric"><strong>Last Success:</strong> ${lastSuccessTime.toLocaleString()}</div>
        <div class="metric"><strong>Last Entry ID:</strong> ${lastEntryId || 'Not initialized'}</div>
        
        <p><small>Auto-refreshes every 30 seconds | <a href="/health">JSON Health Check</a></small></p>
      </div>
    </body>
    </html>
  `);
});

// ✅ DYNAMIC INTERVAL MANAGEMENT
function resetMainInterval() {
  if (mainIntervalId) {
    clearInterval(mainIntervalId);
  }
  
  mainIntervalId = setInterval(checkAndUpdateFirebase, currentInterval);
  console.log(`🔄 Interval reset to ${currentInterval/1000} seconds`);
}

// ✅ GRACEFUL SHUTDOWN - SINGLE HANDLER
let shutdownInitiated = false;

function initiateGracefulShutdown(signal) {
  if (shutdownInitiated) return;
  shutdownInitiated = true;
  
  console.log(`\n🔄 Received ${signal} - Starting graceful shutdown...`);
  isShuttingDown = true;
  
  // Clear all intervals
  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    console.log('✅ Stopped main check interval');
  }
  
  if (memoryInterval) {
    clearInterval(memoryInterval);
    console.log('✅ Stopped memory monitoring');
  }
  
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    console.log('✅ Stopped keep-alive');
  }
  
  // Close server gracefully
  server.close((err) => {
    if (err) {
      console.error('❌ Error during server close:', err);
    } else {
      console.log('✅ Server closed successfully');
    }
    
    console.log('👋 Shutdown complete - goodbye!');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('⏰ Force exit after timeout');
    process.exit(1);
  }, 10000);
}

// ✅ HANDLE SIGNALS (Single handlers only)
process.on('SIGTERM', () => initiateGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => initiateGracefulShutdown('SIGINT'));

// ✅ HANDLE ERRORS WITHOUT CRASHING
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception (NOT CRASHING):', error.message);
  globalErrorCount += 10;
  // Don't exit - try to continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Promise Rejection (NOT CRASHING):', reason);
  globalErrorCount += 5;
  // Don't exit - try to continue
});

// Monitor for interval changes and reset as needed
let lastIntervalCheck = currentInterval;
setInterval(() => {
  if (currentInterval !== lastIntervalCheck) {
    console.log(`⏱️ Interval changed: ${lastIntervalCheck/1000}s → ${currentInterval/1000}s`);
    resetMainInterval();
    lastIntervalCheck = currentInterval;
  }
}, 10000);

// ✅ START THE APPLICATION
console.log('🚀 Starting Telematics Service...');
console.log(`⏱️ Check interval: ${CONFIG.CHECK_INTERVAL/1000} seconds`);
console.log(`🛡️ Max consecutive errors: ${CONFIG.MAX_CONSECUTIVE_ERRORS}`);
console.log(`⏰ Request timeout: ${CONFIG.REQUEST_TIMEOUT/1000} seconds`);

// Start memory monitoring
memoryInterval = setInterval(logMemoryUsage, 5 * 60 * 1000);

// Start keep-alive only in production
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  console.log('🛡️ Starting keep-alive mechanism (10 min intervals)');
  keepAliveInterval = setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
}

// Initial checks
logMemoryUsage();
checkAndUpdateFirebase();
resetMainInterval();

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`📋 Health check: /health`);
  console.log(`🏠 Status page: /`);
  console.log('✅ Service started successfully');
});

server.on('error', (error) => {
  console.error('🚨 Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  }
});

console.log('🎯 Telematics service is ready!');
