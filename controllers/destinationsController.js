// controllers/destinationsController.js
const { query } = require('../config/db');
const path = require('path');

// ── GET /api/destinations ─────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const { search, region, category, sort = 'avg_rating', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = 'WHERE d.is_active = TRUE';

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (d.name ILIKE $${params.length} OR d.area ILIKE $${params.length} OR d.region ILIKE $${params.length})`;
    }
    if (region) { params.push(region); where += ` AND d.region = $${params.length}`; }
    if (category) { params.push(category); where += ` AND d.category = $${params.length}`; }

    const allowed = ['avg_rating', 'visit_count', 'name', 'created_at'];
    const orderBy = allowed.includes(sort) ? sort : 'avg_rating';

    params.push(limit, offset);
    const result = await query(`
      SELECT d.*, 
        (SELECT photo_url FROM destination_photos WHERE destination_id = d.id AND is_primary = TRUE LIMIT 1) AS primary_photo,
        (SELECT COUNT(*) FROM reviews WHERE destination_id = d.id AND status = 'approved') AS review_count
      FROM destinations d
      ${where}
      ORDER BY d.${orderBy} DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const countResult = await query(`SELECT COUNT(*) FROM destinations d ${where}`, params.slice(0, -2));

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (err) { next(err); }
};

// ── GET /api/destinations/:id ─────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;

    const dest = await query(`
      SELECT d.*,
        json_agg(DISTINCT jsonb_build_object('id', p.id, 'url', p.photo_url, 'caption', p.caption, 'is_primary', p.is_primary))
          FILTER (WHERE p.id IS NOT NULL) AS photos
      FROM destinations d
      LEFT JOIN destination_photos p ON p.destination_id = d.id
      WHERE d.id = $1 AND d.is_active = TRUE
      GROUP BY d.id
    `, [id]);

    if (!dest.rows.length) {
      return res.status(404).json({ success: false, message: 'Destination not found.' });
    }

    // Track visit if user is authenticated
    if (req.user) {
      await query(
        `INSERT INTO user_behavior (user_id, destination_id, action) VALUES ($1,$2,'view')`,
        [req.user.id, id]
      );
      // Increment visit count
      await query(`UPDATE destinations SET visit_count = visit_count + 1 WHERE id = $1`, [id]);
    }

    res.json({ success: true, data: dest.rows[0] });
  } catch (err) { next(err); }
};

// ── POST /api/destinations  [Admin] ──────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { name, area, region, category, overview, opening_hours, entry_fee, map_link, latitude, longitude } = req.body;

    const result = await query(`
      INSERT INTO destinations (name, area, region, category, overview, opening_hours, entry_fee, map_link, latitude, longitude, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [name, area, region, category, overview, opening_hours, entry_fee || 0, map_link, latitude, longitude, req.user.id]);

    // Handle uploaded photos
    if (req.files?.length) {
      for (let i = 0; i < req.files.length; i++) {
        const photoUrl = `/uploads/destinations/${req.files[i].filename}`;
        await query(
          `INSERT INTO destination_photos (destination_id, photo_url, is_primary, uploaded_by) VALUES ($1,$2,$3,$4)`,
          [result.rows[0].id, photoUrl, i === 0, req.user.id]
        );
      }
    }

    res.status(201).json({ success: true, message: 'Destination created.', data: result.rows[0] });
  } catch (err) { next(err); }
};

// ── PUT /api/destinations/:id  [Admin] ────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, area, region, category, overview, opening_hours, entry_fee, map_link, latitude, longitude, is_active } = req.body;

    const result = await query(`
      UPDATE destinations
      SET name=$1, area=$2, region=$3, category=$4, overview=$5,
          opening_hours=$6, entry_fee=$7, map_link=$8, latitude=$9,
          longitude=$10, is_active=$11
      WHERE id=$12
      RETURNING *
    `, [name, area, region, category, overview, opening_hours, entry_fee, map_link, latitude, longitude, is_active, id]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Destination not found.' });
    }

    res.json({ success: true, message: 'Destination updated.', data: result.rows[0] });
  } catch (err) { next(err); }
};

// ── DELETE /api/destinations/:id  [Admin] ─────────────────────
exports.remove = async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE destinations SET is_active = FALSE WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Destination not found.' });
    }
    res.json({ success: true, message: 'Destination deactivated.' });
  } catch (err) { next(err); }
};

// ── POST /api/destinations/:id/photos  [Admin] ────────────────
exports.uploadPhotos = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'No photos uploaded.' });
    }
    const photos = [];
    for (const file of req.files) {
      const photoUrl = `/uploads/destinations/${file.filename}`;
      const r = await query(
        `INSERT INTO destination_photos (destination_id, photo_url, caption, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING *`,
        [id, photoUrl, req.body.caption || null, req.user.id]
      );
      photos.push(r.rows[0]);
    }
    res.status(201).json({ success: true, message: `${photos.length} photo(s) uploaded.`, data: photos });
  } catch (err) { next(err); }
};

// ── DELETE /api/destinations/:id/photos/:photoId  [Admin] ─────
exports.deletePhoto = async (req, res, next) => {
  try {
    await query(`DELETE FROM destination_photos WHERE id = $1 AND destination_id = $2`, [req.params.photoId, req.params.id]);
    res.json({ success: true, message: 'Photo deleted.' });
  } catch (err) { next(err); }
};
