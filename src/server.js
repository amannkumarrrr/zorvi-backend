import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { connectDB, disconnectDB } from './config/database.js';

import { execSync } from 'child_process';

const getPidsOnPort = (port) => {
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf-8', timeout: 3000 });
      const pids = new Set();
      for (const line of output.split(/\r?\n/)) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid && !isNaN(pid) && pid !== process.pid) {
            pids.add(pid);
          }
        }
      }
      return Array.from(pids);
    } else {
      const output = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', timeout: 3000 }).trim();
      if (!output) return [];
      return output.split(/\r?\n/).map(p => parseInt(p, 10)).filter(p => p && p !== process.pid);
    }
  } catch (e) {
    return [];
  }
};

const freePortIfOccupied = async (port) => {
  if (process.env.AUTO_FREE_PORT === 'false') return false;
  const pids = getPidsOnPort(port);
  if (pids.length === 0) return false;

  let killedAny = false;
  for (const pid of pids) {
    try {
      console.log(`[Server] Port ${port} is occupied by PID ${pid}. Automatically terminating stale instance...`);
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
      killedAny = true;
    } catch (e) {
      // Process may already have terminated
    }
  }

  if (killedAny) {
    // Wait for the operating system to release the socket
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return killedAny;
};

const PORT = process.env.PORT || 5001;
let server = null;

const startServer = async () => {
  // Prevent duplicate initialization
  if (server) {
    console.warn('[Server] Server is already running. Ignoring duplicate start call.');
    return;
  }

  try {
    // Auto-free port if occupied by stale development instances
    await freePortIfOccupied(PORT);

    // Connect to MongoDB Atlas and initialize defaults
    await connectDB();

    server = app.listen(PORT, () => {
      console.log(`[Server] ZORVI API server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });

    server.on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Server] Port ${PORT} busy, attempting automatic recovery...`);
        const recovered = await freePortIfOccupied(PORT);
        if (recovered) {
          try {
            server = app.listen(PORT, () => {
              console.log(`[Server] ZORVI API server recovered and running on port ${PORT}`);
            });
            return;
          } catch (retryErr) {
            // Fall through to error diagnostics
          }
        }
        console.error(`\n[Server] Port conflict detected: Port ${PORT} is already in use.`);
        console.error(`[Server] To inspect and terminate the process occupying port ${PORT} in PowerShell, run:`);
        console.error(`         $conn = Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }\n`);
        process.exit(1);
      } else {
        console.error('[Server] Server listen error:', err.message);
        process.exit(1);
      }
    });

    // Graceful shutdown handling
    const shutdown = async (signal) => {
      console.log(`\n[Process] Received ${signal}. Shutting down gracefully...`);
      if (server) {
        server.close(() => {
          console.log('[Server] HTTP server closed.');
        });
      }
      await disconnectDB();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('unhandledRejection', (err) => {
      console.error('[Process] Unhandled Rejection:', err.message);
    });

    process.on('uncaughtException', (err) => {
      console.error('[Process] Uncaught Exception:', err.message);
      process.exit(1);
    });
  } catch (error) {
    console.error('[Server] Fatal server startup error:', error.message);
    process.exit(1);
  }
};

startServer();

export default app;
