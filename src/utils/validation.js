const Joi = require('joi');

const validationSchemas = {
  // Auth schemas
  signup: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.min': 'Name must be at least 2 characters long',
        'string.max': 'Name must be less than 100 characters',
        'any.required': 'Name is required',
      }),
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please enter a valid email address',
        'any.required': 'Email is required',
      }),
    phone: Joi.string()
      .pattern(/^[6-9]\d{9}$/)
      .required()
      .messages({
        'string.pattern.base': 'Please enter a valid 10-digit phone number (starting with 6-9)',
        'any.required': 'Phone number is required',
      }),
    password: Joi.string()
      .min(8)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'any.required': 'Password is required',
      }),
    role: Joi.string()
      .valid('CUSTOMER', 'MERCHANT', 'BANKER')
      .required()
      .messages({
        'any.only': 'Role must be one of: CUSTOMER, MERCHANT, BANKER',
        'any.required': 'Role is required',
      }),
  }),

  login: Joi.object({
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please enter a valid email address',
        'any.required': 'Email is required',
      }),
    password: Joi.string()
      .min(8)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'any.required': 'Password is required',
      }),
  }),

  // Loan schemas
  loanApply: Joi.object({
    type: Joi.string()
      .valid('PERSONAL', 'BUSINESS', 'VEHICLE', 'EQUIPMENT')
      .required()
      .messages({
        'any.only': 'Loan type must be one of: PERSONAL, BUSINESS, VEHICLE, EQUIPMENT',
        'any.required': 'Loan type is required',
      }),
    amount: Joi.number()
      .min(1000)
      .max(5000000)
      .required()
      .messages({
        'number.min': 'Loan amount must be at least ₹1,000',
        'number.max': 'Loan amount cannot exceed ₹50,00,000',
        'any.required': 'Loan amount is required',
      }),
    merchantId: Joi.string()
      .uuid()
      .optional()
      .allow(null)
      .messages({
        'string.uuid': 'Invalid merchant ID format',
      }),
    purpose: Joi.string()
      .max(500)
      .optional()
      .messages({
        'string.max': 'Purpose must be less than 500 characters',
      }),
  }),

  loanStatus: Joi.object({
    status: Joi.string()
      .valid('APPROVED', 'REJECTED')
      .required()
      .messages({
        'any.only': 'Status must be APPROVED or REJECTED',
        'any.required': 'Status is required',
      }),
    notes: Joi.string()
      .max(1000)
      .optional()
      .messages({
        'string.max': 'Notes must be less than 1000 characters',
      }),
  }),

  // KYC schemas
  kycUploadUrl: Joi.object({
    docType: Joi.string()
      .valid('ID_PROOF', 'ADDRESS_PROOF', 'PAN_CARD', 'BANK_STATEMENT')
      .required()
      .messages({
        'any.only': 'Document type must be one of: ID_PROOF, ADDRESS_PROOF, PAN_CARD, BANK_STATEMENT',
        'any.required': 'Document type is required',
      }),
  }),

  kycCompleteUpload: Joi.object({
    kycDocId: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.uuid': 'Invalid KYC document ID',
        'any.required': 'KYC document ID is required',
      }),
    publicId: Joi.string()
      .required()
      .messages({
        'any.required': 'Public ID is required',
      }),
    fileSize: Joi.number()
      .integer()
      .min(1)
      .required()
      .messages({
        'number.integer': 'File size must be an integer',
        'number.min': 'File size must be greater than 0',
        'any.required': 'File size is required',
      }),
    contentType: Joi.string()
      .valid('image/jpeg', 'image/png', 'application/pdf')
      .required()
      .messages({
        'any.only': 'Content type must be one of: image/jpeg, image/png, application/pdf',
        'any.required': 'Content type is required',
      }),
  }),

  kycVerify: Joi.object({
    status: Joi.string()
      .valid('VERIFIED', 'REJECTED')
      .required()
      .messages({
        'any.only': 'Status must be VERIFIED or REJECTED',
        'any.required': 'Status is required',
      }),
    notes: Joi.string()
      .max(1000)
      .allow('')
      .optional()
      .messages({
        'string.max': 'Notes must be less than 1000 characters',
      }),
  }),
};

const validate = (schema, data) => {
  try {
    const { error, value } = schema.validate(data, { 
      abortEarly: false,
      stripUnknown: true 
    });
    
    if (error) {
      const validationError = new Error('Validation failed');
      validationError.name = 'ValidationError';
      validationError.isJoi = true;
      validationError.status = 400;
      validationError.validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      throw validationError;
    }
    
    return value;
  } catch (error) {
    if (!error.isJoi) {
      throw error;
    }
    throw error;
  }
};

const validateLoan = (schema, data) => validate(schema, data);
const validateKYC = (schema, data) => validate(schema, data);

module.exports = { 
  validationSchemas, 
  validate, 
  validateLoan,
  validateKYC 
};