const kycService = require('../services/kycService');
const userService = require('../services/userService');
const authMiddleware = require('../middleware/auth');
const { validationSchemas, validateKYC } = require('../utils/validation');
const { logger } = require('../middleware/logger');

class KYCController {
  /**
   * POST /api/v1/kyc/upload-url
   * Generate Cloudinary signature for document upload
   */
  static async generateUploadUrl(req, res, next) {
    try {
      // Only customers and merchants can upload KYC
      if (!['CUSTOMER', 'MERCHANT'].includes(req.user.role)) {
        const error = new Error('Only customers and merchants can upload KYC documents');
        error.status = 403;
        return next(error);
      }

      // Validate request
      const { docType } = validateKYC(validationSchemas.kycUploadUrl, req.body);

      const uploadData = await kycService.generateUploadUrl(req.user.userId, docType);

      const response = {
        success: true,
        message: `Upload signature generated for ${uploadData.instructions}`,
        data: uploadData,
      };

      logger.info('KYC Upload Signature Generated', { 
        userId: req.user.userId, 
        docType, 
        kycDocId: uploadData.kycDocId 
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/kyc/complete-upload
   * Complete KYC upload (update metadata after Cloudinary upload)
   */
  static async completeUpload(req, res, next) {
    try {
      // Only customers and merchants can complete uploads
      if (!['CUSTOMER', 'MERCHANT'].includes(req.user.role)) {
        const error = new Error('Only customers and merchants can complete KYC uploads');
        error.status = 403;
        return next(error);
      }

      const { kycDocId, publicId, fileSize, contentType } = validateKYC(validationSchemas.kycCompleteUpload, req.body);

      const kycDoc = await kycService.completeUpload(
        kycDocId, 
        publicId, 
        fileSize, 
        contentType
      );

      const response = {
        success: true,
        message: 'KYC document uploaded successfully',
        data: {
          kycDoc,
          nextSteps: [
            'Document submitted for verification',
            'Banker review typically takes 1-2 business days',
            'You will receive notification when verified'
          ],
        },
      };

      logger.info('KYC Upload Completed', { 
        userId: req.user.userId, 
        kycDocId, 
        publicId, 
        fileSize 
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
 * GET /api/v1/kyc/status
 * Get user's KYC document status
 */
static async getStatus(req, res, next) {
  try {
    const { status } = req.query; // Optional filter: PENDING, VERIFIED, REJECTED

    const documents = await kycService.getUserKYCDocuments(
      req.user.userId, 
      status
    );

    // Get required documents for this user
    const requiredDocs = kycService.getRequiredDocuments(req.user.role);

    // Check completion status
    const completionStatus = KYCController.calculateKYCCompletion(documents, requiredDocs); // Use class name

    const response = {
      success: true,
      message: `KYC status: ${completionStatus.status}`,
      data: {
        documents,
        requiredDocuments: requiredDocs,
        completion: completionStatus,
        overallStatus: completionStatus.percentComplete === 100 ? 'COMPLETE' : 'INCOMPLETE',
      },
    };

    logger.info('KYC Status Retrieved', { 
      userId: req.user.userId, 
      role: req.user.role,
      complete: completionStatus.percentComplete,
      pendingCount: documents.filter(d => d.isPending).length 
    });

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

  /**
   * POST /api/v1/kyc/verify
   * Verify/reject KYC document (Banker only)
   */
  static async verify(req, res, next) {
    try {
      if (req.user.role !== 'BANKER') {
        const error = new Error('Only bankers can verify KYC documents');
        error.status = 403;
        return next(error);
      }

      const { kycDocId } = req.params;
      const { status, notes } = validateKYC(validationSchemas.kycVerify, req.body);

      const result = await kycService.verifyKYCDocument(
        kycDocId, 
        status, 
        req.user.userId, 
        notes
      );

      const response = {
        success: true,
        message: result.message,
        data: {
          kycDocId,
          newStatus: status,
          action: result.action,
          notes: notes || null,
          timestamp: new Date(),
        },
      };

      logger.info('KYC Document Verified', { 
        kycDocId, 
        status, 
        bankerId: req.user.userId, 
        notes: notes || 'No notes' 
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/kyc/pending
   * Get pending KYC documents for banker review
   */
  static async getPendingForReview(req, res, next) {
    try {
      if (req.user.role !== 'BANKER') {
        const error = new Error('Only bankers can review pending KYC documents');
        error.status = 403;
        return next(error);
      }

      const { limit = 20 } = req.query;
      const documents = await kycService.getPendingKYCForReview(
        req.user.userId, 
        parseInt(limit)
      );

      const response = {
        success: true,
        message: `Found ${documents.length} pending KYC document(s)`,
        data: {
          documents,
          totalPending: documents.length,
          filters: { limit: parseInt(limit) },
        },
      };

      logger.info('Pending KYC Retrieved for Review', { 
        bankerId: req.user.userId, 
        count: documents.length 
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/kyc/:kycDocId/review
   * Get specific KYC document for banker review
   */
  static async getForReview(req, res, next) {
    try {
      if (req.user.role !== 'BANKER') {
        const error = new Error('Only bankers can review KYC documents');
        error.status = 403;
        return next(error);
      }

      const { kycDocId } = req.params;
      const document = await kycService.getKYCForReview(kycDocId);

      const response = {
        success: true,
        message: `KYC document details for review`,
        data: document,
      };

      logger.info('KYC Document Retrieved for Review', { 
        kycDocId, 
        bankerId: req.user.userId, 
        userId: document.userId 
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/kyc/required
   * Get required KYC documents for user
   */
  static async getRequired(req, res, next) {
    try {
      // All authenticated users can see their requirements
      const { loanType } = req.query;
      const requiredDocs = kycService.getRequiredDocuments(req.user.role, loanType);

      const response = {
        success: true,
        message: 'Required KYC documents retrieved',
        data: {
          userRole: req.user.role,
          loanType: loanType || 'general',
          requiredDocuments: requiredDocs,
          totalRequired: requiredDocs.length,
        },
      };

      logger.info('Required KYC Retrieved', { 
        userId: req.user.userId, 
        role: req.user.role,
        loanType: loanType || 'general',
        count: requiredDocs.length 
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Calculate KYC completion status
   */
  static calculateKYCCompletion(documents, requiredDocs) {
    const completedTypes = new Set(documents
      .filter(doc => doc.status === 'VERIFIED')
      .map(doc => doc.type)
    );

    const pendingTypes = new Set(documents
      .filter(doc => doc.status === 'PENDING')
      .map(doc => doc.type)
    );

    const totalRequired = requiredDocs.length;
    const completed = requiredDocs.filter(doc => completedTypes.has(doc.type)).length;
    const pending = requiredDocs.filter(doc => pendingTypes.has(doc.type)).length;
    const incomplete = totalRequired - completed - pending;

    return {
      percentComplete: totalRequired > 0 ? Math.round((completed / totalRequired) * 100) : 0,
      completed,
      pending,
      incomplete,
      status: totalRequired === 0 ? 'NOT_REQUIRED' :
              completed === totalRequired ? 'COMPLETE' :
              pending > 0 ? 'IN_PROGRESS' : 'INCOMPLETE',
      needsAction: pending + incomplete > 0,
    };
  }
}

// Export controller methods with middleware
module.exports = {
  generateUploadUrl: [authMiddleware.authenticate, KYCController.generateUploadUrl],
  completeUpload: [authMiddleware.authenticate, KYCController.completeUpload],
  getStatus: [authMiddleware.authenticate, KYCController.getStatus],
  verify: [
    authMiddleware.authenticate, 
    authMiddleware.authorize(['BANKER']), 
    KYCController.verify
  ],
  getPendingForReview: [
    authMiddleware.authenticate, 
    authMiddleware.authorize(['BANKER']), 
    KYCController.getPendingForReview
  ],
  getForReview: [
    authMiddleware.authenticate, 
    authMiddleware.authorize(['BANKER']), 
    KYCController.getForReview
  ],
  getRequired: [authMiddleware.authenticate, KYCController.getRequired],
};