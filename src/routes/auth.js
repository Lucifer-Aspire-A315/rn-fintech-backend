const express = require('express');
const authController = require('../controllers/authController');
const router = express.Router();

// POST /api/v1/auth/signup - Register new user
router.post('/signup', authController.signup);

// POST /api/v1/auth/login - User login
router.post('/login', authController.login);

module.exports = router;