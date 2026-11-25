const { google } = require('googleapis');
const { readWorkspaceSecretFile, writeWorkspaceSecretFile } = require('./utils/secret-store');
const path = require('path');
const chalk = require('chalk');
const http = require('http');
const { URL } = require('url');
const { assertYouTubeComplianceGate } = require('./utils/youtube-compliance-gate');
const { YOUTUBE_OAUTH_SCOPES } = require('./utils/youtube-oauth-scopes');
const { assertChannelBoundWorkspaceRuntime } = require('./utils/workspace-runtime');

class ModernAuth {
  constructor() {
    this.runtime = assertChannelBoundWorkspaceRuntime();
    this.credentialsPath = path.join(this.runtime.configDir, 'credentials.json');
    this.tokensPath = path.join(this.runtime.configDir, 'tokens.json');
    this.server = null;
  }

  async loadCredentials() {
    return readWorkspaceSecretFile(this.credentialsPath, this.runtime, process.env.AGENTTUBE_MASTER_KEY);
  }

  async loadTokens() {
    return readWorkspaceSecretFile(this.tokensPath, this.runtime, process.env.AGENTTUBE_MASTER_KEY);
  }

  async saveTokens(tokens) {
    return writeWorkspaceSecretFile(this.tokensPath, { youtube: tokens }, this.runtime, process.env.AGENTTUBE_MASTER_KEY);
  }

  async authenticate() {
    assertYouTubeComplianceGate('Legacy modern OAuth authorization');
    console.log(chalk.cyan.bold('\n🔐 YouTube Authentication (Modern Flow)'));
    console.log(chalk.gray('═'.repeat(60)));
    
    try {
      const credentials = await this.loadCredentials();
      
      // Use a random high port to avoid conflicts
      const port = 8000 + Math.floor(Math.random() * 1000);
      const redirectUri = `http://localhost:${port}/callback`;
      
      const oauth2Client = new google.auth.OAuth2(
        credentials.youtube.client_id,
        credentials.youtube.client_secret,
        redirectUri
      );

      const scopes = YOUTUBE_OAUTH_SCOPES;

      // Start a temporary local server
      await this.startTempServer(port, oauth2Client);
      
      // Generate auth URL
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
      });

      console.log(chalk.cyan('🔗 Please visit this URL to authorize:'));
      console.log(chalk.blue(authUrl));

      // Best effort: open the URL in the default browser
      const { exec } = require('child_process');
      const openCommands = {
        win32: `start "" "${authUrl}"`,
        darwin: `open "${authUrl}"`,
        linux: `xdg-open "${authUrl}"`
      };
      if (openCommands[process.platform]) {
        exec(openCommands[process.platform], () => {});
      }
      console.log(chalk.yellow(`\n⚡ A temporary server is running on port ${port}`));
      console.log(chalk.yellow('After authorization, you\'ll be redirected automatically.'));
      console.log(chalk.gray('Waiting for authorization...'));
      
      // The server will handle the rest
      return new Promise((resolve, reject) => {
        this.resolveAuth = resolve;
        this.rejectAuth = reject;
        
        // Set timeout
        setTimeout(() => {
          this.cleanup();
          reject(new Error('Authentication timeout (5 minutes)'));
        }, 300000); // 5 minutes
      });
      
    } catch (error) {
      console.error(chalk.red('Authentication failed:'), error.message);
      throw error;
    }
  }

  async startTempServer(port, oauth2Client) {
    assertYouTubeComplianceGate('Legacy modern OAuth callback server startup');
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <h1>❌ Authorization Error</h1>
            <p>${error}</p>
            <p>You can close this window.</p>
          `);
          this.rejectAuth(new Error(`Authorization error: ${error}`));
          return;
        }
        
        if (code) {
          try {
            assertYouTubeComplianceGate('Legacy modern OAuth callback token exchange');
            const { tokens } = await oauth2Client.getToken(code);
            
            // Save tokens
            await this.saveTokens(tokens);
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: #4CAF50;">🎉 Authentication Successful!</h1>
                  <p>Your YouTube Automation Agent has been authorized!</p>
                  <p><strong>"Ethereal Dreamscript"</strong> is ready for automation.</p>
                  <p>You can close this window and return to the terminal.</p>
                </body>
              </html>
            `);
            
            console.log(chalk.green('\n✅ Authentication successful!'));
            this.cleanup();
            this.resolveAuth(tokens);
            
          } catch (tokenError) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`
              <h1>❌ Token Exchange Failed</h1>
              <p>${tokenError.message}</p>
            `);
            this.rejectAuth(tokenError);
          }
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1>🎬 YouTube Automation Agent</h1>
              <p>Waiting for OAuth callback...</p>
              <p>Please complete the authorization in the other tab.</p>
            </body>
          </html>
        `);
      }
    });
    
    this.server.listen(port, 'localhost');
    console.log(chalk.gray(`Temporary OAuth server started on port ${port}`));
  }
  
  cleanup() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async testAuthentication() {
    assertYouTubeComplianceGate('Legacy modern OAuth token validation');
    try {
      const tokens = await this.loadTokens();
      const credentials = await this.loadCredentials();
      
      const oauth2Client = new google.auth.OAuth2(
        credentials.youtube.client_id,
        credentials.youtube.client_secret
      );
      
      oauth2Client.setCredentials(tokens.youtube);
      
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      const response = await youtube.channels.list({
        part: 'snippet',
        mine: true
      });
      
      if (response.data.items && response.data.items.length > 0) {
        const channel = response.data.items[0];
        console.log(chalk.green(`✅ Connected to channel: ${channel.snippet.title}`));
        console.log(chalk.gray(`   Channel ID: ${channel.id}`));
        console.log(chalk.gray(`   Subscribers: ${channel.statistics?.subscriberCount || 'Hidden'}`));
        return true;
      } else {
        console.log(chalk.red('❌ No channel found'));
        return false;
      }
    } catch (error) {
      console.error(chalk.red('Authentication test failed:'), error.message);
      return false;
    }
  }
}

async function runAuth() {
  const auth = new ModernAuth();
  
  try {
    await auth.authenticate();
    
    console.log(chalk.cyan('\n🧪 Testing authentication...'));
    const success = await auth.testAuthentication();
    
    if (success) {
      console.log(chalk.green.bold('\n🎉 Authentication Complete!'));
      console.log(chalk.cyan('Your "Ethereal Dreamscript" YouTube automation is ready!'));
      console.log(chalk.yellow('\n📋 Next Steps:'));
      console.log(chalk.white('1. Run: npm start'));
      console.log(chalk.white('2. Visit: http://localhost:3456'));
      console.log(chalk.white('3. Your first video will be generated within 24 hours!'));
    } else {
      console.log(chalk.red('\n❌ Authentication test failed.'));
    }
  } catch (error) {
    console.error(chalk.red('\nAuthentication failed:'), error.message);
    if (error.message.includes('timeout')) {
      console.log(chalk.yellow('\n💡 Try again - the authorization window might have closed.'));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runAuth();
}

module.exports = { ModernAuth };