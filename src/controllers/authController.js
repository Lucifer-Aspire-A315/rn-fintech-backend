const userService = require('../services/userService');
const jwtUtil = require('../utils/jwt');
const { validationSchemas, validate } = require('../utils/validation');
const { logger } = require('../middleware/logger');

class AuthController {
  /**
   * POST /api/v1/auth/signup
   * Register new user
   */
  async signup(req, res, next) {
    try {
      // Validate input
      const userData = validate(validationSchemas.signup, req.body);

      // Check if user already exists
      const existingUser = await userService.findUserByEmail(userData.email);
      if (existingUser) {
        const error = new Error('User already exists');
        error.status = 409;
        return next(error);
      }

      // Create user
      const user = await userService.createUser(userData);

      // Generate JWT token
      const token = jwtUtil.generateAccessToken(user);

      // Response (don't return password)
      const response = {
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            createdAt: user.createdAt,
          },
          token,
        },
      };

      logger.info('Signup Successful', { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      });

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/login
   * User login with JWT
   */
  async login(req, res, next) {
    try {
      // Validate input
      const loginData = validate(validationSchemas.login, req.body);

      // Validate credentials
      const user = await userService.validatePassword(
        loginData.email,
        loginData.password
      );

      if (!user) {
        const error = new Error('Invalid email or password');
        error.status = 401;
        return next(error);
      }

      // Generate JWT token
      const token = jwtUtil.generateAccessToken(user);

      // Response
      const response = {
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
          token,
        },
      };

      logger.info('Login Successful', { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();