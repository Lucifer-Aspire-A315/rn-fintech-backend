require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes and middleware
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth'); // ✅ New import
const loanRoutes = require('./routes/loan');
const kycRoutes = require('./routes/kyc');
const { loggerMiddleware } = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Winston logger instance
const { logger } = require('./middleware/logger');

// Security middleware
app.use(helmet());
app.use(cors({ 
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080'], 
  credentials: true 
}));

// Logging middleware
app.use(morgan('combined', {
  stream: { write: message => logger.info('Morgan', { message: message.trim() }) }
}));
app.use(loggerMiddleware);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API versioning prefix logging
app.use('/api/v1', (req, res, next) => {
  logger.info('API Request', { 
    method: req.method, 
    url: req.originalUrl, 
    ip: req.ip 
  });
  next();
});

// ✅ ROUTES - Add auth routes
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes); // ✅ New auth routes
app.use('/api/v1/loan', loanRoutes);
app.use('/api/v1/kyc', kycRoutes);

// Catch-all 404 for /api/v1 routes
app.use('/api/v1', (req, res, next) => {
  notFound(req, res, next);
});

// Global error handler (must be LAST)
app.use(errorHandler);

const startServer = async () => {
  try {
    // Test DB connection via Prisma
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$connect();
    
    logger.info('Database Connection', { 
      status: 'connected', 
      provider: 'PostgreSQL 17.6.1',
      database: 'rn_fintech'
    });
    console.log('✅ Database connected successfully');
    console.log(`📋 Tables: User, Loan, KYCDocument, Notification, AuditLog`);
    
    await prisma.$disconnect();

    // Start server
    const server = app.listen(PORT, 'localhost', () => {
      logger.info('Server Started', { 
        port: PORT, 
        environment: process.env.NODE_ENV,
        baseUrl: `http://localhost:${PORT}/api/v1`
      });
      
      console.log(`🚀 Server running on http://localhost:${PORT}/api/v1`);
      console.log(`📊 Health: http://localhost:${PORT}/api/v1/health`);
      console.log(`🔐 Auth: http://localhost:${PORT}/api/v1/auth/signup`);
      console.log(`🔐 Login: http://localhost:${PORT}/api/v1/auth/login`);
      console.log(`💡 Phase 1 (Auth) complete!`);
      console.log(`🔍 Logs: ./logs/combined.log`);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutdown', { signal: 'SIGTERM' });
      server.close(() => {
        logger.info('Server Closed');
        console.log('Process terminated');
      });
    });

  } catch (error) {
    logger.error('Server Startup Failed', { 
      error: error.message, 
      code: error.code 
    });
    
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;