// middleware/auth.js  –  JWT verification & role guards
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

// ── Verify JWT Token ──────────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user data (handles deleted/deactivated accounts)
    const result = await query(
      'SELECT id, username, email, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    if (!result.rows.length || !result.rows[0].is_active) {
      return res.status(401).json({
        success: false,
        message: 'Token is no longer valid.'
      });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

// ── Admin Guard ───────────────────────────────────────────────
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
  next();
};

// ── Optional Auth (sets req.user if token present, continues either way) ──
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await query(
        'SELECT id, username, email, role FROM users WHERE id = $1 AND is_active = TRUE',
        [decoded.id]
      );
      if (result.rows.length) req.user = result.rows[0];
    }
  } catch (_) { /* no token is fine */ }
  next();
};

module.exports = { protect, adminOnly, optionalAuth };
