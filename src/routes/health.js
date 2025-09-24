const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();

// Health check endpoint
router.get('/', async (req, res) => {
  try {
    const prisma = new PrismaClient();
    
    // Quick DB ping
    await prisma.$queryRaw`SELECT 1 as healthy`;
    
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      database: 'connected',
      uptime: process.uptime()
    });
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      message: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;