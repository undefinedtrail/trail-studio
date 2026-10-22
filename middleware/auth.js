const mongoose = require('mongoose');
const { User } = require('../models/db');

// ============================================================================
// Authentication Middleware
// ============================================================================
// Verifies user identity via header (x-user-email, x-user-id, or Authorization).
// Returns 401 Unauthorized if missing or invalid.
async function authenticate(req, res, next) {
  try {
    const emailHeader = req.headers['x-user-email'];
    const userIdHeader = req.headers['x-user-id'];
    const authHeader = req.headers['authorization'];

    let identifier = emailHeader || userIdHeader;

    if (!identifier && authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        identifier = authHeader.slice(7).trim();
      } else {
        identifier = authHeader.trim();
      }
    }

    if (!identifier) {
      return res.status(401).json({
        error: 'Unauthorized: Authentication required. Provide x-user-email or x-user-id header.',
      });
    }

    let user = null;
    // Check if identifier is an ObjectId or an email string
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      user = await User.findById(identifier);
    }
    if (!user) {
      user = await User.findOne({ email: identifier.toLowerCase().trim() });
    }

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized: User does not exist.',
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
// Role-Based Access Control (RBAC) Middleware
// ============================================================================
// Restricts endpoint access to specific roles. Returns 403 Forbidden on mismatch.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Please log in first.' });
    }

    const roles = Array.isArray(allowedRoles[0]) ? allowedRoles[0] : allowedRoles;

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Action not allowed for role '${req.user.role}'. Required: ${roles.join(' or ')}.`,
      });
    }

    next();
  };
}

// ============================================================================
// Ownership Check Helper for Customers
// ============================================================================
// Specification Rule: If a customer tries to query, view, or modify another customer's
// record/booking, return 404 Not Found (not 403) to prevent customer enumeration.
function enforceOwnership(documentCustomerId, currentUser) {
  if (currentUser.role === 'admin') {
    return true; // Admin has read access across records
  }

  const docIdStr = documentCustomerId ? documentCustomerId.toString() : '';
  const currentUserIdStr = currentUser._id.toString();

  return docIdStr === currentUserIdStr;
}

module.exports = {
  authenticate,
  requireRole,
  enforceOwnership,
};
