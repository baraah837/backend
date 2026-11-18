// controllers/notificationController.js  [Admin management]
const { query } = require('../config/db');

// ── GET /api/admin/notifications ─────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT n.*, u.username AS created_by_name,
             COUNT(nr.id) AS read_count
      FROM notifications n
      LEFT JOIN users u ON u.id = n.created_by
      LEFT JOIN notification_reads nr ON nr.notification_id = n.id
      GROUP BY n.id, u.username
      ORDER BY n.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ── POST /api/admin/notifications ────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { title, message, type = 'offer', target_all = true } = req.body;

    const result = await query(`
      INSERT INTO notifications (title, message, type, target_all, created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [title, message, type, target_all, req.user.id]);

    res.status(201).json({ success: true, message: 'Notification created.', data: result.rows[0] });
  } catch (err) { next(err); }
};

// ── POST /api/admin/notifications/:id/send ───────────────────
exports.send = async (req, res, next) => {
  try {
    const result = await query(`
      UPDATE notifications SET status = 'sent', sent_at = NOW()
      WHERE id = $1 AND status = 'draft'
      RETURNING *
    `, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Notification not found or already sent.' });
    }

    res.json({ success: true, message: 'Notification sent to all users.', data: result.rows[0] });
  } catch (err) { next(err); }
};

// ── DELETE /api/admin/notifications/:id ──────────────────────
exports.remove = async (req, res, next) => {
  try {
    await query('DELETE FROM notifications WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Notification deleted.' });
  } catch (err) { next(err); }
};
