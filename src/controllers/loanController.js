const loanService = require('../services/loanService');
const userService = require('../services/userService');
const { validationSchemas, validateLoan } = require('../utils/validation');
const authMiddleware = require('../middleware/auth');
const { logger } = require('../middleware/logger');

class LoanController {
    /**
     * POST /api/v1/loan/apply
     * Submit loan application (Customer or Merchant)
     */
    static async apply(req, res, next) {
        try {
            // Only customers and merchants can apply
            if (!['CUSTOMER', 'MERCHANT'].includes(req.user.role)) {
                const error = new Error('Only customers and merchants can apply for loans');
                error.status = 403;
                return next(error);
            }

            // Validate input
            const loanData = validateLoan(validationSchemas.loanApply, req.body);

            let finalMerchantId = null;

            // Handle merchant applications
            if (req.user.role === 'MERCHANT') {
                // Check if this is a proxy application (for a customer)
                if (loanData.merchantId) {
                    // Proxy loan: merchant initiating for customer
                    logger.info('Merchant proxy loan application', {
                        merchantId: req.user.userId,
                        customerId: loanData.merchantId
                    });
                    finalMerchantId = req.user.userId; // Merchant is the intermediary
                } else {
                    // Self-application: merchant applying for their own business
                    logger.info('Merchant self-application', {
                        merchantId: req.user.userId
                    });
                    // merchantId remains null - merchant is the applicant
                }
            }

            // Create loan (merchantId will be set only for proxy loans)
            const loan = await loanService.createLoan(
                { ...loanData, merchantId: finalMerchantId },
                req.user.userId
            );

            const response = {
                success: true,
                message: 'Loan application submitted successfully',
                data: {
                    loan,
                    applicationType: req.user.role === 'MERCHANT' && !finalMerchantId
                        ? 'merchant_self'
                        : req.user.role === 'MERCHANT' && finalMerchantId
                            ? 'merchant_proxy'
                            : 'customer_direct',
                    nextSteps: [
                        'Complete KYC verification (if required)',
                        'Wait for banker review (1-3 business days)',
                        'Check status in your dashboard'
                    ],
                },
            };

            logger.info('Loan Application Submitted', {
                loanId: loan.id,
                userId: req.user.userId,
                role: req.user.role,
                applicationType: response.data.applicationType,
                merchantId: finalMerchantId
            });

            res.status(201).json(response);
        } catch (error) {
            next(error);
        }
    }
    /**
     * GET /api/v1/loan/:id/status
     * Get loan status (Customer/Merchant/Banker)
     */
    static async getStatus(req, res, next) {
        try {
            const { id: loanId } = req.params;
            const loan = await loanService.getLoanById(loanId, req.user.userId);

            // Customize response based on user role
            let responseData = {
                loan: {
                    id: loan.id,
                    type: loan.type,
                    amount: loan.amount,
                    status: loan.status,
                    createdAt: loan.createdAt,
                    updatedAt: loan.updatedAt,
                },
                applicant: {
                    name: loan.applicant.name,
                    email: loan.applicant.email,
                },
            };

            // Add merchant info if exists
            if (loan.merchant) {
                responseData.merchant = {
                    name: loan.merchant.name,
                    email: loan.merchant.email,
                };
            }

            // Add recent audit logs for transparency
            if (loan.auditLogs && loan.auditLogs.length > 0) {
                responseData.recentActivity = loan.auditLogs.map(log => ({
                    action: log.action,
                    timestamp: log.createdAt,
                    actorId: log.actorId,
                }));
            }

            // Role-specific enhancements
            switch (req.user.role) {
                case 'BANKER':
                    responseData.fullDetails = {
                        applicant: loan.applicant,
                        merchant: loan.merchant,
                        auditLogs: loan.auditLogs,
                    };
                    break;
                case 'MERCHANT':
                    if (loan.merchantId === req.user.userId) {
                        responseData.isProxyLoan = true;
                    }
                    break;
            }

            const response = {
                success: true,
                message: `Loan status: ${loan.status}`,
                data: responseData,
            };

            logger.info('Loan Status Retrieved', {
                loanId,
                userId: req.user.userId,
                role: req.user.role,
                status: loan.status
            });

            res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/loan/list
     * List user's loans based on role
     */
    static async listLoans(req, res, next) {
        try {
            const { status, type, limit = 10 } = req.query;
            const filters = { status, type, limit: parseInt(limit) };

            const loans = await loanService.getUserLoans(
                req.user.userId,
                req.user.role,
                filters
            );

            const response = {
                success: true,
                message: `Found ${loans.length} loan(s)`,
                data: {
                    loans: loans.map(loan => ({
                        id: loan.id,
                        type: loan.type,
                        amount: loan.amount,
                        status: loan.status,
                        createdAt: loan.createdAt,
                        applicant: loan.applicant ? {
                            name: loan.applicant.name,
                            role: loan.applicant.role,
                        } : null,
                    })),
                    filters,
                    total: loans.length,
                },
            };

            logger.info('Loan List Retrieved', {
                userId: req.user.userId,
                role: req.user.role,
                count: loans.length
            });

            res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/v1/loan/:id/approve
     * Approve loan (Banker only)
     */
    static async approve(req, res, next) {
        try {
            if (req.user.role !== 'BANKER') {
                const error = new Error('Only bankers can approve loans');
                error.status = 403;
                return next(error);
            }

            const { id: loanId } = req.params;
            const { notes } = req.body;

            const loan = await loanService.updateLoanStatus(
                loanId,
                'APPROVED',
                req.user.userId,
                notes || 'Loan approved by banker'
            );

            const response = {
                success: true,
                message: 'Loan approved successfully',
                data: {
                    loan: {
                        id: loan.id,
                        status: loan.status,
                        updatedAt: loan.updatedAt,
                    },
                    nextSteps: [
                        'Funds will be disbursed within 2 business days',
                        'Notification sent to applicant',
                        'Audit trail updated'
                    ],
                },
            };

            logger.info('Loan Approved', {
                loanId,
                bankerId: req.user.userId,
                notes: notes || 'No notes provided'
            });

            res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/v1/loan/:id/reject
     * Reject loan (Banker only)
     */
    static async reject(req, res, next) {
        try {
            if (req.user.role !== 'BANKER') {
                const error = new Error('Only bankers can reject loans');
                error.status = 403;
                return next(error);
            }

            const { id: loanId } = req.params;
            const { notes } = req.body;

            const loan = await loanService.updateLoanStatus(
                loanId,
                'REJECTED',
                req.user.userId,
                notes || 'Loan rejected by banker'
            );

            const response = {
                success: true,
                message: 'Loan rejected',
                data: {
                    loan: {
                        id: loan.id,
                        status: loan.status,
                        updatedAt: loan.updatedAt,
                    },
                    notificationSent: true,
                },
            };

            logger.info('Loan Rejected', {
                loanId,
                bankerId: req.user.userId,
                notes: notes || 'No notes provided'
            });

            res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/loan/analytics/merchant
     * Get merchant loan analytics (Merchant only)
     */
    static async merchantAnalytics(req, res, next) {
        try {
            if (req.user.role !== 'MERCHANT') {
                const error = new Error('Only merchants can view analytics');
                error.status = 403;
                return next(error);
            }

            const { startDate, endDate, status } = req.query;
            const filters = { startDate, endDate, status };

            const analytics = await loanService.getMerchantAnalytics(
                req.user.userId,
                filters
            );

            const response = {
                success: true,
                message: 'Merchant analytics retrieved',
                data: analytics,
            };

            logger.info('Merchant Analytics Accessed', {
                merchantId: req.user.userId,
                period: analytics.period
            });

            res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    }
}

// Export individual methods for easy route binding
module.exports = {
    apply: [authMiddleware.authenticate, LoanController.apply],
    getStatus: [authMiddleware.authenticate, LoanController.getStatus],
    listLoans: [authMiddleware.authenticate, LoanController.listLoans],
    approve: [authMiddleware.authenticate, authMiddleware.authorize(['BANKER']), LoanController.approve],
    reject: [authMiddleware.authenticate, authMiddleware.authorize(['BANKER']), LoanController.reject],
    merchantAnalytics: [authMiddleware.authenticate, authMiddleware.authorize(['MERCHANT']), LoanController.merchantAnalytics],
};