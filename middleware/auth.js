const jwt = require('jsonwebtoken');
const { User } = require('../models/db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing. Please set JWT_SECRET in your .env file.');
}

// ============================================================================
// 1. Generate Signed JWT Token
// ============================================================================
function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ============================================================================
// 2. Authentication Middleware
// ============================================================================
// Verifies Bearer JWT token from Authorization header.
// Rejects unauthenticated or invalid requests with 401 Unauthorized.
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required. Please log in to proceed.',
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        error: 'Authentication token missing.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({
        error: 'Invalid or expired session. Please log in again.',
      });
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        error: 'User account no longer exists.',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err.message);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
}

// ============================================================================
// 3. Role-Based Access Control (RBAC) Middleware
// ============================================================================
// Checks whether authenticated user has the required role.
// Note: 'studio' and 'admin' are treated as synonymous for studio management.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    let roles = Array.isArray(allowedRoles[0]) ? allowedRoles[0] : allowedRoles;
    if (roles.includes('admin') && !roles.includes('studio')) {
      roles.push('studio');
    }
    if (roles.includes('studio') && !roles.includes('admin')) {
      roles.push('admin');
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. This action is restricted to ${roles.join(' or ')} users.`,
      });
    }

    next();
  };
}

// ============================================================================
// 4. Ownership Verification Helper for Customer Records
// ============================================================================
// Assignment Rule: If a customer attempts to query, view, or modify another customer's
// record, the server strictly returns 404 Not Found (not 403) to prevent customer enumeration.
function enforceOwnership(documentCustomerId, currentUser) {
  if (currentUser.role === 'admin' || currentUser.role === 'studio') {
    return true; // Studio has view access across all studio records
  }

  const docIdStr = documentCustomerId ? documentCustomerId.toString() : '';
  const currentUserIdStr = currentUser._id.toString();

  return docIdStr === currentUserIdStr;
}

module.exports = {
  generateToken,
  authenticate,
  requireRole,
  enforceOwnership,
};
