const express = require('express');
const kycController = require('../controllers/kycController');
const router = express.Router();

// Customer/Merchant routes
router.post('/upload-url', kycController.generateUploadUrl);
router.post('/complete-upload', kycController.completeUpload);
router.get('/status', kycController.getStatus);
router.get('/required', kycController.getRequired);

// Banker routes
router.get('/pending', kycController.getPendingForReview);
router.get('/:kycDocId/review', kycController.getForReview);
router.post('/:kycDocId/verify', kycController.verify);

module.exports = router;