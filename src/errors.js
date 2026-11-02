class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.code = 'validation_error';
    this.details = details;
  }
}

module.exports = { ValidationError };
