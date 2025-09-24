const { logger } = require('./logger');

const errorHandler = (err, req, res, next) => {
  // Log error with request details
  const errorLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    error: {
      name: err.name,
      message: err.message,
      status: err.status || err.statusCode || 500,
      stack: err.stack
    }
  };
  
  logger.error('Application Error', errorLog);
  
  // Determine status code
  let statusCode = err.status || err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Response structure
  let response = {
    success: false,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    message: isProduction ? 'Internal server error' : err.message,
    statusCode
  };
  
  // Handle validation errors (Joi)
  if (err.isJoi || err.name === 'ValidationError') {
    statusCode = 400;
    response.message = 'Validation failed';
    response.statusCode = 400;
    
    // Include specific validation errors
    if (err.validationErrors && err.validationErrors.length > 0) {
      response.errors = err.validationErrors;
    } else if (err.details && err.details.length > 0) {
      response.errors = err.details.map(detail => detail.message);
    } else {
      response.errors = ['Invalid input provided'];
    }
    
    logger.warn('Validation Error', { 
      path: req.originalUrl, 
      errors: response.errors,
      body: req.body 
    });
    
    return res.status(400).json(response);
  }
  
  // Handle custom errors with status
  if (err.status || err.statusCode) {
    statusCode = err.status || err.statusCode;
    response.message = err.message;
    response.statusCode = statusCode;
  }
  
  // Handle Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    response.message = 'Duplicate entry';
    response.statusCode = 409;
    response.field = err.meta?.target?.[0] || 'unknown';
    
    logger.warn('Duplicate Entry', { 
      path: req.originalUrl, 
      field: response.field,
      value: req.body[response.field] 
    });
  }
  
  // Handle authentication errors
  if (err.name === 'UnauthorizedError' || err.message.includes('token')) {
    statusCode = 401;
    response.message = 'Invalid or missing token';
    response.statusCode = 401;
    
    logger.warn('Unauthorized Access', { 
      path: req.originalUrl, 
      ip: req.ip 
    });
  }
  
  // Include stack trace in development
  if (!isProduction && err.stack) {
    response.stack = err.stack;
  }
  
  // Default error response
  res.status(statusCode).json(response);
};

module.exports = errorHandler;