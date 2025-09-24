const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { logger } = require('../middleware/logger');

const prisma = new PrismaClient();

class UserService {
  /**
   * Create a new user with hashed password
   */
  async createUser(userData) {
    try {
      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(userData.password, saltRounds);

      // Create user in database
      const user = await prisma.user.create({
        data: {
          name: userData.name,
          email: userData.email,
          phone: userData.phone,
          passwordHash: hashedPassword,
          role: userData.role,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      });

      logger.info('User Created', { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      });

      return user;
    } catch (error) {
      logger.error('User Creation Failed', { 
        email: userData.email, 
        error: error.message 
      });
      
      // Handle unique constraint violations
      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0] || 'unknown';
        const message = field === 'email' ? 'Email already exists' : 
                       field === 'phone' ? 'Phone number already exists' : 
                       'User already exists';
        const errorWithStatus = new Error(message);
        errorWithStatus.status = 409;
        throw errorWithStatus;
      }
      
      throw error;
    }
  }

  /**
   * Find user by email
   */
  async findUserByEmail(email) {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          role: true,
          name: true,
        },
      });

      return user;
    } catch (error) {
      logger.error('Find User By Email Failed', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Validate user password
   */
  async validatePassword(email, password) {
    try {
      const user = await this.findUserByEmail(email);
      if (!user) {
        return null;
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (isValid) {
        // Return user without password
        const { passwordHash, ...userWithoutPassword } = user;
        return userWithoutPassword;
      }

      return null;
    } catch (error) {
      logger.error('Password Validation Failed', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Get user profile by ID (for authenticated users)
   */
  async getUserProfile(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }

      logger.info('User Profile Retrieved', { userId: user.id, role: user.role });
      return user;
    } catch (error) {
      logger.error('Get User Profile Failed', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId, updateData) {
    try {
      // Only allow updating name, phone (not email or role)
      const allowedUpdates = ['name', 'phone'];
      const updates = Object.keys(updateData).filter(key => 
        allowedUpdates.includes(key)
      ).reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {});

      if (Object.keys(updates).length === 0) {
        return { message: 'No valid fields to update' };
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: updates,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          updatedAt: true,
        },
      });

      logger.info('User Profile Updated', { 
        userId: user.id, 
        updatedFields: Object.keys(updates) 
      });

      return user;
    } catch (error) {
      logger.error('Update User Profile Failed', { userId, error: error.message });
      throw error;
    }
  }
}

module.exports = new UserService();