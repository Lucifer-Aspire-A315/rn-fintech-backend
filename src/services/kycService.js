const { PrismaClient } = require('@prisma/client');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../middleware/logger');

const prisma = new PrismaClient();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

class KYCService {
  /**
   * Generate pre-signed URL for document upload to Cloudinary
   */
  async generateUploadUrl(userId, docType) {
  try {
    const allowedTypes = ['ID_PROOF', 'ADDRESS_PROOF', 'PAN_CARD', 'BANK_STATEMENT'];
    if (!allowedTypes.includes(docType)) {
      const error = new Error('Invalid document type');
      error.status = 400;
      throw error;
    }

    // Create unique public ID
    const publicId = `${userId}/${docType}/${uuidv4()}-${Date.now()}`;
    
    // Generate Cloudinary signature for secure upload
    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp,
        public_id: publicId,
        folder: process.env.CLOUDINARY_KYC_FOLDER, // Include folder in signature
      },
      process.env.CLOUDINARY_API_SECRET
    );

    // Create KYC record (pending upload)
    const kycDoc = await this.createKYCDocument(userId, docType, 'UPLOADING', publicId);

    logger.info('Cloudinary Upload URL Generated', { 
      userId, 
      docType, 
      kycDocId: kycDoc.id, 
      publicId 
    });

    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
      kycDocId: kycDoc.id,
      publicId,
      signature,
      timestamp,
      apiKey: process.env.CLOUDINARY_API_KEY,
      folder: process.env.CLOUDINARY_KYC_FOLDER,
      instructions: `Upload your ${this.getDocTypeName(docType)} (Max 5MB, JPG/PNG/PDF)`,
    };
  } catch (error) {
    logger.error('Generate Upload URL Failed', { 
      userId, 
      docType, 
      error: error.message 
    });
    throw error;
  }
}

  /**
   * Create KYC document record
   */
  async createKYCDocument(userId, type, status = 'PENDING', publicId = null) {
    try {
      const kycDoc = await prisma.kYCDocument.create({
        data: {
          type,
          url: publicId ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${publicId}` : null,
          status,
          userId,
        },
        select: {
          id: true,
          type: true,
          url: true,
          status: true,
          userId: true,
          createdAt: true,
        },
      });

      logger.info('KYC Document Created', { 
        kycDocId: kycDoc.id, 
        userId, 
        type, 
        status 
      });

      return kycDoc;
    } catch (error) {
      logger.error('Create KYC Document Failed', { 
        userId, 
        type, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Complete document upload (update metadata)
   */
  async completeUpload(kycDocId, publicId, fileSize, contentType) {
    try {
      // Validate file
      if (fileSize > parseInt(process.env.KYC_MAX_FILE_SIZE || '5242880')) {
        const error = new Error('File size exceeds 5MB limit');
        error.status = 413;
        throw error;
      }

      const allowedTypes = (process.env.KYC_ALLOWED_TYPES || 'image/jpeg,image/png,application/pdf').split(',');
      if (!allowedTypes.includes(contentType)) {
        const error = new Error('Invalid file type. Only JPG, PNG, PDF allowed');
        error.status = 415;
        throw error;
      }

      // Update KYC document
      const kycDoc = await prisma.kYCDocument.update({
        where: { id: kycDocId },
        data: {
          url: `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${publicId}`,
          status: 'PENDING',
          verifiedBy: null,
        },
        select: {
          id: true,
          type: true,
          url: true,
          status: true,
          userId: true,
        },
      });

      // Create audit log
      await this.createKYCAuditLog(kycDocId, 'DOCUMENT_UPLOADED', null, `File uploaded: ${fileSize} bytes, ${contentType}`);

      logger.info('KYC Upload Completed', { 
        kycDocId, 
        publicId, 
        fileSize, 
        contentType 
      });

      return kycDoc;
    } catch (error) {
      logger.error('Complete Upload Failed', { 
        kycDocId, 
        publicId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get KYC documents for user
   */
  async getUserKYCDocuments(userId, status = null) {
    try {
      const whereClause = { userId };
      if (status) {
        whereClause.status = status;
      }

      const documents = await prisma.kYCDocument.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          url: true,
          status: true,
          createdAt: true,
          verifiedBy: true,
        },
      });

      // Enrich with document type names
      const enrichedDocs = documents.map(doc => ({
        ...doc,
        docTypeName: this.getDocTypeName(doc.type),
        isPending: doc.status === 'PENDING',
        needsResubmission: doc.status === 'REJECTED',
      }));

      logger.info('KYC Documents Retrieved', { 
        userId, 
        count: documents.length, 
        pending: enrichedDocs.filter(d => d.isPending).length 
      });

      return enrichedDocs;
    } catch (error) {
      logger.error('Get User KYC Failed', { 
        userId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get pending KYC documents for banker review
   */
  async getPendingKYCForReview(bankerId, limit = 20) {
    try {
      const documents = await prisma.kYCDocument.findMany({
        where: {
          status: 'PENDING',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      const enrichedDocs = documents.map(doc => ({
        ...doc,
        userFullName: doc.user.name,
        userRole: doc.user.role,
        daysPending: Math.floor(
          (new Date() - new Date(doc.createdAt)) / (1000 * 60 * 60 * 24)
        ),
      }));

      logger.info('Pending KYC Retrieved for Review', { 
        bankerId, 
        count: documents.length 
      });

      return enrichedDocs;
    } catch (error) {
      logger.error('Get Pending KYC Failed', { 
        bankerId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Verify/reject KYC document (Banker only)
   */
  async verifyKYCDocument(kycDocId, status, bankerId, notes = '') {
    try {
      const validStatuses = ['VERIFIED', 'REJECTED'];
      if (!validStatuses.includes(status)) {
        const error = new Error('Status must be VERIFIED or REJECTED');
        error.status = 400;
        throw error;
      }

      // Update document status
      const kycDoc = await prisma.kYCDocument.update({
        where: { id: kycDocId },
        data: {
          status,
          verifiedBy: status === 'VERIFIED' ? bankerId : null,
        },
        select: {
          id: true,
          type: true,
          status: true,
          userId: true,
          url: true,
        },
      });

      // Create audit log
      const action = status === 'VERIFIED' ? 'KYC_VERIFIED' : 'KYC_REJECTED';
      await this.createKYCAuditLog(kycDocId, action, bankerId, notes);

      logger.info('KYC Document Verified', { 
        kycDocId, 
        status, 
        bankerId, 
        userId: kycDoc.userId,
        notes: notes.substring(0, 100) 
      });

      return {
        kycDoc,
        action,
        message: status === 'VERIFIED' 
          ? 'Document verified successfully' 
          : `Document rejected: ${notes}`,
      };
    } catch (error) {
      logger.error('Verify KYC Document Failed', { 
        kycDocId, 
        bankerId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get KYC document details for review
   */
  async getKYCForReview(kycDocId) {
    try {
      const document = await prisma.kYCDocument.findUnique({
        where: { id: kycDocId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              role: true,
            },
          },
        },
      });

      if (!document) {
        const error = new Error('KYC document not found');
        error.status = 404;
        throw error;
      }

      return {
        ...document,
        docTypeName: this.getDocTypeName(document.type),
        isOverdue: document.status === 'PENDING' && 
          Math.floor((new Date() - new Date(document.createdAt)) / (1000 * 60 * 60 * 24)) > 3,
      };
    } catch (error) {
      logger.error('Get KYC for Review Failed', { 
        kycDocId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Create KYC audit log
   */
  async createKYCAuditLog(kycDocId, action, actorId, details = '') {
    try {
      await prisma.auditLog.create({
        data: {
          loanId: null, // KYC documents aren't tied to specific loans yet
          action: `KYC_${action}`,
          actorId,
          // Store details as JSON if needed
        },
      });

      logger.debug('KYC Audit Log Created', { 
        kycDocId, 
        action, 
        actorId, 
        details 
      });
    } catch (error) {
      logger.error('KYC Audit Log Failed', { 
        kycDocId, 
        action, 
        error: error.message 
      });
      // Don't throw - audit shouldn't break main flow
    }
  }

  /**
   * Get document type display name
   */
  getDocTypeName(type) {
    const typeNames = {
      'ID_PROOF': 'Government ID (Aadhaar/Passport)',
      'ADDRESS_PROOF': 'Address Proof (Utility Bill/Bank Statement)',
      'PAN_CARD': 'PAN Card',
      'BANK_STATEMENT': 'Bank Statement (Last 6 months)',
    };
    return typeNames[type] || type;
  }

  /**
   * Get required documents based on user role and loan type
   */
  getRequiredDocuments(userRole, loanType = null) {
    const baseRequirements = {
      CUSTOMER: ['ID_PROOF', 'ADDRESS_PROOF', 'PAN_CARD'],
      MERCHANT: ['ID_PROOF', 'ADDRESS_PROOF', 'PAN_CARD', 'BANK_STATEMENT'],
      BANKER: [], // Bankers don't submit KYC
    };

    let requirements = baseRequirements[userRole] || [];

    // Add loan-type specific requirements
    if (loanType) {
      const loanSpecific = {
        'BUSINESS': ['BANK_STATEMENT'],
        'VEHICLE': ['ADDRESS_PROOF'],
        'EQUIPMENT': ['BANK_STATEMENT'],
      };
      requirements = [...new Set([...requirements, ...(loanSpecific[loanType] || [])])];
    }

    return requirements.map(type => ({
      type,
      displayName: this.getDocTypeName(type),
      isRequired: true,
      status: 'NOT_STARTED',
    }));
  }
}

module.exports = new KYCService();