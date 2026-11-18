// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

// ── Helper: generate tokens ───────────────────────────────────
const generateTokens = (user) => {
  const payload = { id: user.id, email: user.email, role: user.role };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );

  return { accessToken, refreshToken };
};

// ── POST /api/auth/register ───────────────────────────────────
exports.register = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // Store email lowercase always
    const emailLower = email.trim().toLowerCase();

    // Check if email already exists
    const existing = await query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [emailLower]
    );
    if (existing.rows.length) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, role, created_at`,
      [username.trim(), emailLower, password_hash]
    );

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user);

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, refreshToken, expiresAt]
    );

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: {
        user: { id: user.id, username: user.username, email: user.email, role: user.role },
        accessToken,
        refreshToken
      }
    });
  } catch (err) {
    // Handle unique constraint violation
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Username or email already exists.' });
    }
    next(err);
  }
};

// ── POST /api/auth/login ──────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await query(
      `SELECT id, username, email, password_hash, role, is_active, photo_url
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is disabled.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const { accessToken, refreshToken } = generateTokens(user);

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, refreshToken, expiresAt]
    );

    res.json({
      success: true,
      message: 'Login successful.',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          photo_url: user.photo_url
        },
        accessToken,
        refreshToken
      }
    });
  } catch (err) { next(err); }
};

// ── POST /api/auth/refresh ────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token required.' });
    }

    // Verify token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Check token in DB (not expired, not revoked)
    const stored = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (!stored.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const user = await query(
      'SELECT id, email, role FROM users WHERE id = $1 AND is_active = TRUE',
      [decoded.id]
    );

    if (!user.rows.length) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.rows[0]);

    // Rotate refresh token
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [decoded.id, newRefreshToken, expiresAt]
    );

    res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    }
    next(err);
  }
};

// ── POST /api/auth/logout ─────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) { next(err); }
};
