const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { assertYouTubeComplianceGate } = require('./utils/youtube-compliance-gate');
const { YOUTUBE_OAUTH_SCOPES } = require('./utils/youtube-oauth-scopes');
const { assertIsolatedWorkspaceRuntime } = require('./utils/workspace-runtime');

class OAuthServer {
  constructor() {
    this.runtime = assertIsolatedWorkspaceRuntime();
    this.credentialsPath = path.join(this.runtime.configDir, 'credentials.json');
    this.tokensPath = path.join(this.runtime.configDir, 'tokens.json');
    this.app = express();
    this.server = null;
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.get('/auth/callback', async (req, res) => {
      const { code, error } = req.query;
      
      if (error) {
        res.send(`<h1>❌ Authentication Error</h1><p>${error}</p>`);
        return;
      }

      if (!code) {
        res.send(`<h1>❌ No Authorization Code</h1><p>No authorization code received</p>`);
        return;
      }

      try {
        // Exchange code for tokens
        await this.exchangeCodeForTokens(code);
        
        res.send(`
          <h1>🎉 Authentication Successful!</h1>
          <p>Your YouTube Automation Agent has been successfully authorized!</p>
          <p>You can close this window and return to the terminal.</p>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            h1 { color: #4CAF50; }
          </style>
        `);
        
        console.log(chalk.green('\n✅ Authentication successful! Starting YouTube Automation Agent...'));
        
        // Close the server after successful auth
        setTimeout(() => {
          this.server.close();
          this.startMainApplication();
        }, 2000);
        
      } catch (error) {
        console.error(chalk.red('Token exchange failed:'), error);
        res.send(`<h1>❌ Token Exchange Failed</h1><p>${error.message}</p>`);
      }
    });

    this.app.get('/', (req, res) => {
      res.send(`
        <h1>🎬 YouTube Automation Agent</h1>
        <p>OAuth callback server is running...</p>
        <p>Please complete the authorization process.</p>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        </style>
      `);
    });
  }

  async exchangeCodeForTokens(code) {
    assertYouTubeComplianceGate('Legacy OAuth token exchange');
    const credentials = JSON.parse(fs.readFileSync(this.credentialsPath));
    
    const oauth2Client = new google.auth.OAuth2(
      credentials.youtube.client_id,
      credentials.youtube.client_secret,
      credentials.youtube.redirect_uris[0]
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    // Save tokens
    const tokenData = {
      youtube: tokens
    };
    
    fs.writeFileSync(this.tokensPath, JSON.stringify(tokenData, null, 2));
    console.log(chalk.green('✅ Tokens saved successfully!'));
  }

  async startMainApplication() {
    console.log(chalk.cyan('\n🚀 Starting YouTube Automation Agent...'));
    
    // Import and start the main application
    const { spawn } = require('child_process');
    const mainApp = spawn('node', ['index.js'], {
      stdio: 'inherit',
      cwd: __dirname
    });
    
    mainApp.on('close', (code) => {
      console.log(chalk.yellow(`Main application exited with code ${code}`));
    });
  }

  start() {
    assertYouTubeComplianceGate('Legacy OAuth server startup');
    this.server = this.app.listen(8080, () => {
      console.log(chalk.cyan('\n🔐 OAuth callback server started on http://localhost:8080'));
      this.generateAuthUrl();
    });
  }

  generateAuthUrl() {
    assertYouTubeComplianceGate('Legacy OAuth authorization URL generation');
    const credentials = JSON.parse(fs.readFileSync(this.credentialsPath));
    
    const oauth2Client = new google.auth.OAuth2(
      credentials.youtube.client_id,
      credentials.youtube.client_secret,
      credentials.youtube.redirect_uris[0]
    );

    const scopes = YOUTUBE_OAUTH_SCOPES;

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    console.log(chalk.cyan.bold('\n🎬 YouTube Automation Agent - OAuth Setup'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log(chalk.cyan('\n🔗 Please visit this URL to authorize the application:'));
    console.log(chalk.blue.underline(authUrl));
    console.log(chalk.yellow('\nAfter authorization, you will be redirected back automatically.'));
    console.log(chalk.gray('The OAuth server will handle the rest!'));
  }
}

if (require.main === module) {
  const oauthServer = new OAuthServer();
  oauthServer.start();
}

module.exports = { OAuthServer };