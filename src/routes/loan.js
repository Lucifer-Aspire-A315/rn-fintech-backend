const express = require('express');
const loanController = require('../controllers/loanController');
const router = express.Router();

// Apply loan (Customer or Merchant) - POST /api/v1/loan/apply
router.post('/apply', loanController.apply);

// Get loan status (Customer/Merchant/Banker) - GET /api/v1/loan/:id/status
router.get('/:id/status', loanController.getStatus);

// List user's loans - GET /api/v1/loan/list
router.get('/list', loanController.listLoans);

// Banker actions
router.post('/:id/approve', loanController.approve);
router.post('/:id/reject', loanController.reject);

// Merchant analytics - GET /api/v1/loan/analytics/merchant
router.get('/analytics/merchant', loanController.merchantAnalytics);

module.exports = router;