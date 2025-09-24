const { PrismaClient } = require('@prisma/client');
const { logger } = require('../middleware/logger');

const prisma = new PrismaClient();

class LoanService {
  /**
   * Create new loan application
   */
  async createLoan(loanData, userId) {
    try {
      const loan = await prisma.loan.create({
        data: {
          type: loanData.type,
          amount: loanData.amount,
          status: 'PENDING',
          applicantId: userId,
          merchantId: loanData.merchantId || null,
          bankerId: null,
        },
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          applicantId: true,
          merchantId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Create audit log
      await this.createAuditLog(loan.id, 'LOAN_CREATED', userId, 'Loan application submitted');

      logger.info('Loan Created', { 
        loanId: loan.id, 
        type: loan.type, 
        amount: loan.amount, 
        applicantId: userId,
        merchantId: loanData.merchantId 
      });

      return loan;
    } catch (error) {
      logger.error('Loan Creation Failed', { 
        applicantId: userId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get loan by ID with relations
   */
  async getLoanById(loanId, userId) {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          applicant: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          merchant: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          auditLogs: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      if (!loan) {
        const error = new Error('Loan not found');
        error.status = 404;
        throw error;
      }

      // Authorization: User must be applicant, merchant, or banker
      const canAccess = loan.applicantId === userId || 
                       loan.merchantId === userId || 
                       (userId && loan.bankerId === userId);

      if (!canAccess) {
        const error = new Error('Unauthorized access to loan');
        error.status = 403;
        throw error;
      }

      logger.info('Loan Retrieved', { 
        loanId, 
        userId, 
        userRole: loan.applicant.role 
      });

      return loan;
    } catch (error) {
      logger.error('Get Loan Failed', { loanId, userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get loans for a user based on their role
   */
  async getUserLoans(userId, role, filters = {}) {
    try {
      let whereClause = {};

      switch (role) {
        case 'CUSTOMER':
          whereClause = { applicantId: userId };
          break;
        case 'MERCHANT':
          whereClause = {
            OR: [
              { applicantId: userId },
              { merchantId: userId }
            ]
          };
          break;
        case 'BANKER':
          whereClause = { status: 'PENDING' }; // Bankers see pending loans
          break;
        default:
          whereClause = { applicantId: userId };
      }

      // Apply filters
      if (filters.status) {
        whereClause.status = filters.status;
      }
      if (filters.type) {
        whereClause.type = filters.type;
      }
      if (filters.minAmount) {
        whereClause.amount = { gte: filters.minAmount };
      }

      const loans = await prisma.loan.findMany({
        where: whereClause,
        include: {
          applicant: {
            select: { id: true, name: true, email: true, role: true },
          },
          merchant: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 20,
      });

      logger.info('User Loans Retrieved', { 
        userId, 
        role, 
        count: loans.length, 
        filters 
      });

      return loans;
    } catch (error) {
      logger.error('Get User Loans Failed', { userId, role, error: error.message });
      throw error;
    }
  }

  /**
   * Update loan status (approve/reject - banker only)
   */
  async updateLoanStatus(loanId, status, userId, notes = '') {
    try {
      // Validate new status
      const validStatuses = ['APPROVED', 'REJECTED'];
      if (!validStatuses.includes(status)) {
        const error = new Error('Invalid status transition');
        error.status = 400;
        throw error;
      }

      // Update loan
      const loan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          status,
          bankerId: userId,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          applicantId: true,
          merchantId: true,
          bankerId: true,
          updatedAt: true,
        },
      });

      // Create audit log
      const action = status === 'APPROVED' ? 'LOAN_APPROVED' : 'LOAN_REJECTED';
      await this.createAuditLog(loanId, action, userId, notes);

      logger.info('Loan Status Updated', { 
        loanId, 
        newStatus: status, 
        bankerId: userId, 
        notes: notes.substring(0, 100) 
      });

      return loan;
    } catch (error) {
      logger.error('Update Loan Status Failed', { 
        loanId, 
        userId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Create audit log entry
   */
  async createAuditLog(loanId, action, actorId, details = '') {
    try {
      await prisma.auditLog.create({
        data: {
          loanId,
          action,
          actorId,
          // details can be JSON stringified if needed
        },
      });

      logger.info('Audit Log Created', { 
        loanId, 
        action, 
        actorId, 
        details: details.substring(0, 200) 
      });
    } catch (error) {
      logger.error('Audit Log Creation Failed', { 
        loanId, 
        action, 
        actorId, 
        error: error.message 
      });
      // Don't throw - audit logs shouldn't break main flow
    }
  }

  /**
   * Get merchant loan analytics
   */
  async getMerchantAnalytics(merchantId, filters = {}) {
    try {
      const whereClause = { merchantId };
      
      if (filters.status) {
        whereClause.status = filters.status;
      }
      if (filters.startDate || filters.endDate) {
        whereClause.createdAt = {};
        if (filters.startDate) whereClause.createdAt.gte = new Date(filters.startDate);
        if (filters.endDate) whereClause.createdAt.lte = new Date(filters.endDate);
      }

      const [totalLoans, approvedLoans, totalAmount, avgApprovalTime] = await Promise.all([
        // Total loans
        prisma.loan.count({ where: whereClause }),
        // Approved loans
        prisma.loan.count({ 
          where: { ...whereClause, status: 'APPROVED' } 
        }),
        // Total approved amount
        prisma.loan.aggregate({
          where: { ...whereClause, status: 'APPROVED' },
          _sum: { amount: true },
        }),
        // Average approval time (from creation to approval)
        prisma.loan.findMany({
          where: { ...whereClause, status: 'APPROVED' },
          select: { createdAt: true, updatedAt: true },
        }).then(loans => {
          if (loans.length === 0) return 0;
          const avgTime = loans.reduce((sum, loan) => {
            const timeDiff = loan.updatedAt.getTime() - loan.createdAt.getTime();
            return sum + timeDiff;
          }, 0) / loans.length;
          return Math.round(avgTime / (1000 * 60 * 60 * 24)); // Days
        }),
      ]);

      const analytics = {
        merchantId,
        period: filters.startDate && filters.endDate 
          ? `${filters.startDate} to ${filters.endDate}` 
          : 'All time',
        totalLoans,
        approvedLoans,
        approvalRate: totalLoans > 0 ? Math.round((approvedLoans / totalLoans) * 100) : 0,
        totalApprovedAmount: totalAmount._sum?.amount || 0,
        averageApprovalTimeDays: avgApprovalTime,
        generatedAt: new Date(),
      };

      logger.info('Merchant Analytics Generated', { 
        merchantId, 
        totalLoans, 
        approvalRate: analytics.approvalRate 
      });

      return analytics;
    } catch (error) {
      logger.error('Merchant Analytics Failed', { 
        merchantId, 
        error: error.message 
      });
      throw error;
    }
  }
}

module.exports = new LoanService();