// controllers/recommendationController.js
const { query } = require('../config/db');

// ── GET /api/recommendations ──────────────────────────────────
// Returns personalized recommendations based on user profile + behavior
exports.getRecommendations = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    // Weights from env
    const W_RATING     = parseFloat(process.env.AI_RECOMMENDATION_WEIGHT_RATING)     || 0.4;
    const W_POPULARITY = parseFloat(process.env.AI_RECOMMENDATION_WEIGHT_POPULARITY) || 0.3;
    const W_INTERESTS  = parseFloat(process.env.AI_RECOMMENDATION_WEIGHT_INTERESTS)  || 0.3;

    let userInterests = [];
    let userBudget    = null;
    let visitedIds    = [];

    if (userId) {
      // Fetch user preferences
      const userResult = await query(
        'SELECT interests, budget FROM users WHERE id = $1', [userId]
      );
      if (userResult.rows.length) {
        const u = userResult.rows[0];
        userInterests = u.interests ? u.interests.split(',').map(i => i.trim()) : [];
        userBudget    = u.budget;
      }

      // Fetch already-visited destinations (don't re-recommend)
      const visited = await query(
        `SELECT DISTINCT destination_id FROM user_behavior WHERE user_id = $1 AND action = 'view'`,
        [userId]
      );
      visitedIds = visited.rows.map(r => r.destination_id);
    }

    // Map interests to categories
    const interestMap = {
      'Nature':    ['Nature', 'Beach'],
      'Beaches':   ['Beach'],
      'Mountains': ['Nature', 'Adventure'],
      'Culture':   ['Historic'],
      'History':   ['Historic'],
      'Desert':    ['Adventure'],
      'Adventure': ['Adventure']
    };
    const targetCategories = userInterests
      .flatMap(i => interestMap[i] || [i])
      .filter((v, i, a) => a.indexOf(v) === i);  // unique

    // Score destinations using a weighted formula
    const maxVisits = await query(`SELECT MAX(visit_count) AS max FROM destinations WHERE is_active = TRUE`);
    const maxV = parseInt(maxVisits.rows[0].max) || 1;

    const result = await query(`
      SELECT d.id, d.name, d.area, d.region, d.category,
             d.avg_rating, d.visit_count, d.overview,
             (SELECT photo_url FROM destination_photos WHERE destination_id = d.id AND is_primary = TRUE LIMIT 1) AS photo
      FROM destinations d
      WHERE d.is_active = TRUE
        AND ($1::uuid[] IS NULL OR d.id != ALL($1::uuid[]))
      ORDER BY d.avg_rating DESC
      LIMIT 50
    `, [visitedIds.length ? visitedIds : null]);

    const scored = result.rows.map(d => {
      const ratingScore     = (d.avg_rating / 5) * W_RATING;
      const popularityScore = (d.visit_count / maxV) * W_POPULARITY;
      const interestScore   = targetCategories.includes(d.category) ? W_INTERESTS : 0;
      const totalScore      = ratingScore + popularityScore + interestScore;
      return { ...d, score: parseFloat(totalScore.toFixed(4)) };
    });

    // Sort by score descending, return top 10
    scored.sort((a, b) => b.score - a.score);
    const recommendations = scored.slice(0, 10);

    res.json({
      success: true,
      data: recommendations,
      meta: {
        based_on: userId ? 'user_profile_and_behavior' : 'popularity_and_rating',
        user_interests: userInterests,
        target_categories: targetCategories
      }
    });
  } catch (err) { next(err); }
};

// ── GET /api/recommendations/trending ────────────────────────
// Top destinations by views + bookmarks in last 30 days
exports.getTrending = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT d.id, d.name, d.area, d.region, d.category, d.avg_rating,
             COUNT(ub.id) AS interactions_30d,
             (SELECT photo_url FROM destination_photos WHERE destination_id = d.id AND is_primary = TRUE LIMIT 1) AS photo
      FROM destinations d
      LEFT JOIN user_behavior ub ON ub.destination_id = d.id
        AND ub.created_at >= NOW() - INTERVAL '30 days'
        AND ub.action IN ('view','bookmark','trip')
      WHERE d.is_active = TRUE
      GROUP BY d.id
      ORDER BY interactions_30d DESC, d.avg_rating DESC
      LIMIT 6
    `);

    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ── GET /api/admin/analytics  [Admin] ─────────────────────────
exports.adminAnalytics = async (req, res, next) => {
  try {
    const [users, destinations, reviews, trips, behavior, sentiment] = await Promise.all([
      // User stats
      query(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS new_this_month,
               SUM(CASE WHEN last_login >= NOW() - INTERVAL '7 days'  THEN 1 ELSE 0 END) AS active_this_week
        FROM users WHERE role = 'user'
      `),
      // Destination stats
      query(`
        SELECT COUNT(*) AS total,
               ROUND(AVG(avg_rating), 2) AS platform_avg_rating,
               SUM(visit_count) AS total_visits
        FROM destinations WHERE is_active = TRUE
      `),
      // Review stats
      query(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
               SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
               SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
        FROM reviews
      `),
      // Trip stats
      query(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN is_ai_generated THEN 1 ELSE 0 END) AS ai_generated
        FROM trips
      `),
      // Most visited destinations
      query(`
        SELECT d.name, d.region, COUNT(ub.id) AS view_count
        FROM user_behavior ub
        JOIN destinations d ON d.id = ub.destination_id
        WHERE ub.action = 'view'
        GROUP BY d.id, d.name, d.region
        ORDER BY view_count DESC LIMIT 5
      `),
      // Sentiment breakdown
      query(`
        SELECT sentiment_label, COUNT(*) AS count
        FROM reviews
        WHERE status = 'approved' AND sentiment_label IS NOT NULL
        GROUP BY sentiment_label
      `)
    ]);

    res.json({
      success: true,
      data: {
        users:        users.rows[0],
        destinations: destinations.rows[0],
        reviews:      reviews.rows[0],
        trips:        trips.rows[0],
        most_visited: behavior.rows,
        sentiment:    sentiment.rows
      }
    });
  } catch (err) { next(err); }
};

// ── GET /api/admin/users  [Admin] ─────────────────────────────
exports.adminGetUsers = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = "WHERE u.role = 'user'";

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (u.username ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    params.push(limit, offset);
    const result = await query(`
      SELECT u.id, u.username, u.email, u.location, u.is_active, u.last_login, u.created_at,
             COUNT(DISTINCT t.id) AS trips_count,
             COUNT(DISTINCT r.id) AS reviews_count
      FROM users u
      LEFT JOIN trips t ON t.user_id = u.id
      LEFT JOIN reviews r ON r.user_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ── PUT /api/admin/users/:id/toggle  [Admin] ─────────────────
exports.adminToggleUser = async (req, res, next) => {
  try {
    const result = await query(`
      UPDATE users SET is_active = NOT is_active
      WHERE id = $1 AND role = 'user'
      RETURNING id, username, is_active
    `, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      message: `User ${result.rows[0].is_active ? 'activated' : 'deactivated'}.`,
      data: result.rows[0]
    });
  } catch (err) { next(err); }
};
