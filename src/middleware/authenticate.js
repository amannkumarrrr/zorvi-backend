import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const authenticate = async (req, res, next) => {
  try {
    const candidateTokens = [];

    // 1. Authorization header (explicit token from frontend)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const headerToken = req.headers.authorization.split(' ')[1];
      if (headerToken && headerToken !== 'null' && headerToken !== 'undefined') {
        candidateTokens.push(headerToken);
      }
    }

    // 2. HTTP-only cookie
    if (req.cookies && req.cookies.aura_token) {
      const cookieToken = req.cookies.aura_token;
      if (cookieToken && cookieToken !== 'null' && cookieToken !== 'undefined' && !candidateTokens.includes(cookieToken)) {
        candidateTokens.push(cookieToken);
      }
    }

    if (candidateTokens.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in to continue.',
        errors: [],
      });
    }

    // Verify token candidate
    let decoded = null;
    let lastError = null;

    for (const token of candidateTokens) {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
        if (decoded && decoded.id) {
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!decoded || !decoded.id) {
      if (lastError && lastError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Your session has expired. Please log in again.',
          errors: [],
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.',
        errors: [],
      });
    }

    // Find user
    const user = await User.findById(decoded.id).select('+passwordHash');
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account not found or inactive. Please log in again.',
        errors: [],
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Authentication failed.',
      errors: [],
    });
  }
};

export default authenticate;
