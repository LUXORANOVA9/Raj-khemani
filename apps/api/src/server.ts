import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { env } from './config/env';
import { setupSocketIO } from './socket';
import { errorHandler } from './middleware/error.middleware';
import { logger } from './utils/logger';

// Route imports
import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import chipsRoutes from './modules/chips/chips.routes';
import tablesRoutes from './modules/tables/tables.routes';
import adminRoutes from './modules/admin/admin.routes';

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(helmet());
app.use(cors({
  origin: env.SOCKET_CORS_ORIGINS.split(','),
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/chips', chipsRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/admin', adminRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Start server
async function start() {
  try {
    // Set up Socket.IO
    await setupSocketIO(httpServer);

    httpServer.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT}`, {
        env: env.NODE_ENV,
        port: env.PORT,
      });
      logger.info('API endpoints:');
      logger.info('  POST /api/auth/login');
      logger.info('  POST /api/auth/register');
      logger.info('  POST /api/auth/refresh');
      logger.info('  GET  /api/users/me');
      logger.info('  GET  /api/chips/balance');
      logger.info('  POST /api/chips/distribute');
      logger.info('  GET  /api/tables');
      logger.info('  POST /api/tables');
      logger.info('  GET  /api/admin/dashboard');
      logger.info('  GET  /health');
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();

export { app, httpServer };
