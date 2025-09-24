const notFound = (req, res, next) => {
  // Only handle 404 for API routes
  if (req.originalUrl.startsWith('/api/v1')) {
    res.status(404).json({
      success: false,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      message: `API endpoint not found: ${req.originalUrl}`,
      statusCode: 404,
      suggestion: 'Available: /api/v1/health'
    });
  } else {
    // Let Express handle non-API 404s
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
  }
};

module.exports = notFound;