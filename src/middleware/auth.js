const jwtUtil = require('../utils/jwt');
const { logger } = require('./logger');

const authMiddleware = {
  /**
   * Verify JWT token and attach user to request
   */
  authenticate: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      const token = jwtUtil.extractTokenFromHeader(authHeader);
      const decoded = jwtUtil.verifyToken(token);

      // Attach user to request
      req.user = decoded;
      
      logger.info('Token Verified', { 
        userId: decoded.userId, 
        role: decoded.role 
      });

      next();
    } catch (error) {
      logger.warn('Authentication Failed', { 
        path: req.originalUrl, 
        ip: req.ip 
      });
      next(error);
    }
  },

  /**
   * Role-based access control
   */
  authorize: (roles = []) => {
    return (req, res, next) => {
      if (!req.user) {
        const error = new Error('User not authenticated');
        error.status = 401;
        return next(error);
      }

      if (roles.length && !roles.includes(req.user.role)) {
        const error = new Error('Insufficient permissions');
        error.status = 403;
        logger.warn('Access Denied', { 
          userId: req.user.userId, 
          role: req.user.role, 
          requiredRoles: roles,
          path: req.originalUrl 
        });
        return next(error);
      }

      next();
    };
  },

  /**
   * Role helpers
   */
  requireCustomer: () => authMiddleware.authorize(['CUSTOMER']),
  requireMerchant: () => authMiddleware.authorize(['MERCHANT']),
  requireBanker: () => authMiddleware.authorize(['BANKER']),
  requireAny: () => authMiddleware.authorize(['CUSTOMER', 'MERCHANT', 'BANKER']),
};

module.exports = authMiddleware;