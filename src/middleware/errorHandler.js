export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error occurred';
  let errors = err.errors || [];

  // Mongoose CastError (e.g. invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 404;
    message = `Resource not found with invalid identifier: ${err.value}`;
  }

  // MongoDB duplicate key error (e.g. unique email or slug)
  if (err.code === 11000) {
    statusCode = 409;
    const duplicateFields = Object.keys(err.keyValue || {});
    const fieldName = duplicateFields[0] || 'field';
    const fieldValue = err.keyValue ? err.keyValue[fieldName] : '';
    message = `A record with ${fieldName} "${fieldValue}" already exists.`;
    errors = [{ field: fieldName, message: `This ${fieldName} is already in use.` }];
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    errors = Object.values(err.errors).map((val) => ({
      field: val.path,
      message: val.message,
    }));
  }

  // JSON Syntax Error in request body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    message = 'Malformed JSON in request body.';
  }

  // Log 500 errors internally for debugging, but never expose stack traces to client
  if (statusCode === 500) {
    console.error(`[Server Error 500] ${req.method} ${req.url}:`, err);
    message = 'An unexpected server error occurred. Please try again later.';
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
};

export default errorHandler;
