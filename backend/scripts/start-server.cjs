/**
 * Simple backend startup script that uses compiled files
 */

// Load environment variables
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');

const PORT = process.env.PORT || '43111';
const HOST = process.env.HOST || '0.0.0.0';

console.log('[Backend] Starting backend server...');
console.log('[Backend] PORT:', PORT);
console.log('[Backend] HOST:', HOST);
console.log('[Backend] DATABASE_URL:', process.env.DATABASE_URL ? '***CONFIGURED***' : 'NOT SET');

// Kill any existing process on port 43111
spawn('taskkill', ['/F', '/IM', 'node.exe', '/FI', `eq ${PORT}`], { shell: true });
spawn('taskkill', ['/F', '/IM', 'node.exe', '/FI', `eq ${PORT}`], { shell: true });

// Wait 1 second
setTimeout(() => {
  // Start backend using compiled preload.js
  const backend = spawn('node', ['dist/backend/src/preload.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env }
  });

  backend.stdout.on('data', (data) => {
    console.log('[Backend]', data.toString().trim());
  });

  backend.stderr.on('data', (data) => {
    console.error('[Backend Error]', data.toString().trim());
  });

  backend.on('close', (code) => {
    console.log(`[Backend] exited with code ${code}`);
    if (code !== 0) {
      console.error('[Backend] Failed to start!');
    }
  });

  backend.on('error', (err) => {
    console.error('[Backend] Error:', err);
  });
}, 1000);
