const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database simulation
let userWebhooks = new Map();
let webhookLogs = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Create new directory with webhooks
app.post('/api/create-directory', (req, res) => {
  const { 
    directoryName,
    webhookUrl,
    title,
    description 
  } = req.body;

  // Validate directory name
  if (!directoryName || !/^[a-zA-Z0-9-_]+$/.test(directoryName)) {
    return res.status(400).json({
      success: false,
      message: 'Directory name can only contain letters, numbers, hyphens, and underscores'
    });
  }

  // Check if directory exists
  if (userWebhooks.has(directoryName)) {
    return res.status(400).json({
      success: false,
      message: 'Directory name already taken. Please choose another one.'
    });
  }

  const userIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  // Create webhook configuration
  const webhookConfig = {
    id: directoryName,
    title: title || 'Dual Hook Generator',
    description: description || '24/7 Webhook Endpoints',
    directoryName: directoryName,
    webhookUrl: webhookUrl,
    userIp: userIp,
    createdAt: new Date().toISOString(),
    isActive: true,
    // Dual webhook endpoints
    endpoints: {
      primary: `${getBaseUrl()}/${directoryName}/webhook1`,
      secondary: `${getBaseUrl()}/${directoryName}/webhook2`,
      api: `${getBaseUrl()}/${directoryName}/api`
    },
    stats: {
      webhook1: { requests: 0, lastRequest: null },
      webhook2: { requests: 0, lastRequest: null },
      api: { requests: 0, lastRequest: null },
      totalRequests: 0
    }
  };

  // Store configuration
  userWebhooks.set(directoryName, webhookConfig);
  webhookLogs.set(directoryName, []);

  res.status(201).json({
    success: true,
    message: '🎉 Dual Hook Generator Created Successfully!',
    data: {
      directory: directoryName,
      urls: {
        homepage: `${getBaseUrl()}/${directoryName}`,
        webhook1: webhookConfig.endpoints.primary,
        webhook2: webhookConfig.endpoints.secondary,
        api: webhookConfig.endpoints.api
      },
      usage: {
        example1: `curl -X POST ${webhookConfig.endpoints.primary} -d '{"message": "Hello"}'`,
        example2: `curl -X POST ${webhookConfig.endpoints.secondary} -d '{"event": "test"}'`
      }
    }
  });
});

// Dynamic directory homepage
app.get('/:directory', (req, res) => {
  const { directory } = req.params;
  
  const config = userWebhooks.get(directory);
  if (!config) {
    return res.status(404).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>❌ Directory Not Found</h1>
          <p>The directory "${directory}" doesn't exist.</p>
          <a href="/">Create your own Dual Hook Generator</a>
        </body>
      </html>
    `);
  }

  // Serve dynamic homepage for this directory
  res.send(generateDirectoryPage(config));
});

// Webhook endpoint 1
app.post('/:directory/webhook1', (req, res) => {
  processWebhook(req, res, 'webhook1');
});

// Webhook endpoint 2
app.post('/:directory/webhook2', (req, res) => {
  processWebhook(req, res, 'webhook2');
});

// API endpoint for directory
app.all('/:directory/api', (req, res) => {
  processWebhook(req, res, 'api');
});

// Get directory stats
app.get('/:directory/stats', (req, res) => {
  const { directory } = req.params;
  const config = userWebhooks.get(directory);
  
  if (!config) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  const logs = webhookLogs.get(directory) || [];
  
  res.json({
    directory: directory,
    config: config,
    stats: config.stats,
    recentLogs: logs.slice(-10).reverse(),
    totalLogs: logs.length
  });
});

// Process webhook function
function processWebhook(req, res, endpointType) {
  const { directory } = req.params;
  const config = userWebhooks.get(directory);
  
  if (!config) {
    return res.status(404).json({ 
      success: false, 
      message: 'Directory not found' 
    });
  }

  // Update stats
  config.stats[endpointType].requests++;
  config.stats[endpointType].lastRequest = new Date().toISOString();
  config.stats.totalRequests++;

  // Log the request
  const logEntry = {
    id: generateId(),
    directory: directory,
    endpoint: endpointType,
    timestamp: new Date().toISOString(),
    method: req.method,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  const logs = webhookLogs.get(directory) || [];
  logs.push(logEntry);
  webhookLogs.set(directory, logs);

  console.log(`📨 ${endpointType} request for ${directory}:`, {
    ip: logEntry.ip,
    method: logEntry.method
  });

  // Forward to user's webhook URL if provided
  if (config.webhookUrl && endpointType !== 'api') {
    forwardToUserWebhook(config.webhookUrl, logEntry)
      .catch(err => console.error('Forwarding failed:', err));
  }

  res.json({
    success: true,
    message: `Webhook received by ${endpointType}`,
    directory: directory,
    endpoint: endpointType,
    timestamp: logEntry.timestamp,
    requestId: logEntry.id,
    yourData: req.body
  });
}

// Forward to user's webhook
async function forwardToUserWebhook(userWebhookUrl, logEntry) {
  try {
    await axios.post(userWebhookUrl, {
      originalRequest: logEntry,
      forwardedAt: new Date().toISOString(),
      source: 'dual-hook-generator'
    }, {
      timeout: 5000
    });
    console.log(`✅ Forwarded webhook to ${userWebhookUrl}`);
  } catch (error) {
    console.log('❌ Forwarding failed:', error.message);
  }
}

// Utility functions
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  } else if (process.env.VERCEL) {
    return `https://${process.env.VERCEL_URL}`;
  } else {
    return `http://localhost:${PORT}`;
  }
}

function generateDirectoryPage(config) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.title} - Dual Hook Gen</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Arial', sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; 
            color: #333;
            padding: 20px;
        }
        .container { 
            max-width: 1000px; 
            margin: 0 auto; 
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        .header { 
            text-align: center; 
            margin-bottom: 30px; 
        }
        .header h1 { 
            color: #667eea; 
            margin-bottom: 10px; 
            font-size: 2.5em;
        }
        .header p { 
            color: #666; 
            font-size: 1.2em;
        }
        .endpoints { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 20px; 
            margin: 30px 0; 
        }
        .endpoint-card { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 10px; 
            border-left: 4px solid #667eea;
        }
        .endpoint-card h3 { 
            color: #667eea; 
            margin-bottom: 10px; 
        }
        .webhook-url { 
            background: #e9ecef; 
            padding: 10px; 
            border-radius: 5px; 
            font-family: monospace; 
            word-break: break-all;
            margin: 10px 0;
            border: 1px dashed #667eea;
        }
        .btn { 
            background: #667eea; 
            color: white; 
            border: none; 
            padding: 10px 20px; 
            border-radius: 5px; 
            cursor: pointer; 
            margin: 5px; 
        }
        .stats { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 10px; 
            margin: 20px 0; 
        }
        .code-block { 
            background: #2d3748; 
            color: #e2e8f0; 
            padding: 15px; 
            border-radius: 8px; 
            font-family: monospace; 
            margin: 10px 0; 
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${config.title}</h1>
            <p>${config.description}</p>
            <p><strong>Directory:</strong> ${config.directoryName}</p>
        </div>

        <div class="endpoints">
            <div class="endpoint-card">
                <h3>🌐 Webhook Endpoint 1</h3>
                <div class="webhook-url">${config.endpoints.primary}</div>
                <button class="btn" onclick="copyUrl('${config.endpoints.primary}')">Copy URL</button>
                <button class="btn" onclick="testEndpoint('${config.endpoints.primary}')">Test</button>
            </div>
            
            <div class="endpoint-card">
                <h3>🔗 Webhook Endpoint 2</h3>
                <div class="webhook-url">${config.endpoints.secondary}</div>
                <button class="btn" onclick="copyUrl('${config.endpoints.secondary}')">Copy URL</button>
                <button class="btn" onclick="testEndpoint('${config.endpoints.secondary}')">Test</button>
            </div>

            <div class="endpoint-card">
                <h3>⚡ API Endpoint</h3>
                <div class="webhook-url">${config.endpoints.api}</div>
                <button class="btn" onclick="copyUrl('${config.endpoints.api}')">Copy URL</button>
                <button class="btn" onclick="testEndpoint('${config.endpoints.api}')">Test</button>
            </div>
        </div>

        <div class="stats">
            <h3>📊 Live Statistics</h3>
            <div id="statsContent">Loading...</div>
        </div>

        <div class="code-block">
// Example usage with cURL:
curl -X POST ${config.endpoints.primary} \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello from Webhook 1!"}'

curl -X POST ${config.endpoints.secondary} \\
  -H "Content-Type: application/json" \\
  -d '{"event": "user_action", "data": {"user": "john_doe"}}'
        </div>

        <div style="text-align: center; margin-top: 30px; color: #666;">
            <p>Powered by <strong>Dual Hook Gen</strong> - 24/7 Webhook Service</p>
            <p>📍 <a href="/" style="color: #667eea;">Create your own Dual Hook Generator</a></p>
        </div>
    </div>

    <script>
        function copyUrl(url) {
            navigator.clipboard.writeText(url).then(() => {
                alert('✅ URL copied to clipboard!');
            });
        }

        async function testEndpoint(url) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        test: true,
                        message: 'This is a test request from your dashboard',
                        timestamp: new Date().toISOString()
                    })
                });
                
                const result = await response.json();
                alert('✅ Test successful! Response: ' + JSON.stringify(result));
                loadStats(); // Refresh stats
            } catch (error) {
                alert('❌ Test failed: ' + error.message);
            }
        }

        async function loadStats() {
            try {
                const response = await fetch('/${config.directoryName}/stats');
                const data = await response.json();
                
                document.getElementById('statsContent').innerHTML = \`
                    <p><strong>Total Requests:</strong> \${data.stats.totalRequests}</p>
                    <p><strong>Webhook 1 Requests:</strong> \${data.stats.webhook1.requests}</p>
                    <p><strong>Webhook 2 Requests:</strong> \${data.stats.webhook2.requests}</p>
                    <p><strong>API Requests:</strong> \${data.stats.api.requests}</p>
                    <p><strong>Last Activity:</strong> \${new Date(data.stats.webhook1.lastRequest).toLocaleString() || 'No activity yet'}</p>
                \`;
            } catch (error) {
                document.getElementById('statsContent').innerHTML = 'Failed to load statistics';
            }
        }

        // Load stats on page load and every 10 seconds
        loadStats();
        setInterval(loadStats, 10000);
    </script>
</body>
</html>
  `;
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Dual Hook Generator running on port ${PORT}`);
  console.log(`📍 Homepage: ${getBaseUrl()}`);
});

module.exports = app;
