const jwt = require('jsonwebtoken');
const { logger } = require('../middleware/logger');

class JWTUtil {
  /**
   * Generate access token
   */
  generateAccessToken(user) {
    try {
      const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      });

      logger.info('JWT Access Token Generated', { 
        userId: user.id, 
        role: user.role, 
        expiresIn: process.env.JWT_EXPIRES_IN 
      });

      return token;
    } catch (error) {
      logger.error('JWT Generation Failed', { 
        userId: user.id, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Verify token and extract user info
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded;
    } catch (error) {
      logger.warn('JWT Verification Failed', { error: error.message });
      
      const jwtError = new Error('Invalid or expired token');
      jwtError.status = 401;
      throw jwtError;
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authorization) {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      const error = new Error('Missing or invalid Authorization header');
      error.status = 401;
      throw error;
    }

    return authorization.split(' ')[1];
  }
}

module.exports = new JWTUtil();