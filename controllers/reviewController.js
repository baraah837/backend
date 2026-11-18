// controllers/reviewController.js
const { query } = require('../config/db');
const Sentiment = require('sentiment');
const sentiment = new Sentiment();

// ── Analyze sentiment score ───────────────────────────────────
const analyzeSentiment = (text) => {
  if (!text) return { score: 0, label: 'neutral' };
  const result = sentiment.analyze(text);
  // Normalize comparative score to -1..1 range
  const normalized = Math.max(-1, Math.min(1, result.comparative));
  const label = normalized > 0.1 ? 'positive' : normalized < -0.1 ? 'negative' : 'neutral';
  return { score: parseFloat(normalized.toFixed(3)), label };
};

// ── GET /api/destinations/:id/reviews ────────────────────────
exports.getByDestination = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(`
      SELECT r.id, r.rating, r.comment, r.sentiment_label, r.created_at,
             u.username, u.photo_url AS user_photo
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.destination_id = $1 AND r.status = 'approved'
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `, [id, limit, offset]);

    const stats = await query(`
      SELECT 
        COUNT(*) AS total,
        ROUND(AVG(rating), 2) AS avg_rating,
        SUM(CASE WHEN sentiment_label = 'positive' THEN 1 ELSE 0 END) AS positive_count,
        SUM(CASE WHEN sentiment_label = 'negative' THEN 1 ELSE 0 END) AS negative_count,
        SUM(CASE WHEN sentiment_label = 'neutral'  THEN 1 ELSE 0 END) AS neutral_count
      FROM reviews
      WHERE destination_id = $1 AND status = 'approved'
    `, [id]);

    res.json({
      success: true,
      data: result.rows,
      stats: stats.rows[0],
      pagination: { page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (err) { next(err); }
};

// ── POST /api/destinations/:id/reviews ───────────────────────
exports.create = async (req, res, next) => {
  try {
    const { id: destination_id } = req.params;
    const { rating, comment } = req.body;

    // Check destination exists
    const dest = await query('SELECT id FROM destinations WHERE id = $1 AND is_active = TRUE', [destination_id]);
    if (!dest.rows.length) {
      return res.status(404).json({ success: false, message: 'Destination not found.' });
    }

    const { score, label } = analyzeSentiment(comment);

    const result = await query(`
      INSERT INTO reviews (user_id, destination_id, rating, comment, sentiment_score, sentiment_label)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id, destination_id) DO UPDATE
        SET rating=$3, comment=$4, sentiment_score=$5, sentiment_label=$6, status='pending', updated_at=NOW()
      RETURNING *
    `, [req.user.id, destination_id, rating, comment, score, label]);

    // Track behavior
    await query(
      `INSERT INTO user_behavior (user_id, destination_id, action) VALUES ($1,$2,'review')`,
      [req.user.id, destination_id]
    );

    res.status(201).json({
      success: true,
      message: 'Review submitted and pending approval.',
      data: result.rows[0]
    });
  } catch (err) { next(err); }
};

// ── GET /api/users/me/reviews ─────────────────────────────────
exports.getMyReviews = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT r.*, d.name AS destination_name,
             (SELECT photo_url FROM destination_photos WHERE destination_id = d.id AND is_primary = TRUE LIMIT 1) AS dest_photo
      FROM reviews r
      JOIN destinations d ON d.id = r.destination_id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
    `, [req.user.id]);

    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ── DELETE /api/users/me/reviews/:id ─────────────────────────
exports.deleteMyReview = async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }
    res.json({ success: true, message: 'Review deleted.' });
  } catch (err) { next(err); }
};

// ── GET /api/admin/reviews  [Admin] ──────────────────────────
exports.adminGetAll = async (req, res, next) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(`
      SELECT r.*, u.username, u.email,
             d.name AS destination_name
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      JOIN destinations d ON d.id = r.destination_id
      WHERE ($1::text = 'all' OR r.status = $1::comment_status)
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `, [status, limit, offset]);

    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ── PUT /api/admin/reviews/:id  [Admin] ───────────────────────
exports.adminModerate = async (req, res, next) => {
  try {
    const { status, admin_note } = req.body;   // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected.' });
    }

    const result = await query(`
      UPDATE reviews SET status=$1, admin_note=$2 WHERE id=$3 RETURNING *
    `, [status, admin_note || null, req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    // Recalculate destination avg_rating
    const review = result.rows[0];
    await query(`
      UPDATE destinations
      SET avg_rating = (
        SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)
        FROM reviews WHERE destination_id = $1 AND status = 'approved'
      )
      WHERE id = $1
    `, [review.destination_id]);

    res.json({ success: true, message: `Review ${status}.`, data: result.rows[0] });
  } catch (err) { next(err); }
};
