// controllers/businessAdminController.js – NEW admin endpoints (mounted at /api/admin-biz). Admin only.
const { query } = require('../config/db');
const { getSetting } = require('../services/payment');

const bad = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const clean = (v) => (v === '' ? null : v);

// Generic CRUD for simple admin-managed tables (column names are whitelisted → no injection through keys)
const crud = (table, cols, { order = 'created_at DESC', requiredCols = [], jsonCols = [] } = {}) => ({
  list: async (req, res, next) => {
    try { res.json({ success: true, data: (await query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows }); } catch (e) { next(e); }
  },
  create: async (req, res, next) => {
    try {
      for (const c of requiredCols) if (req.body[c] === undefined || req.body[c] === '') return bad(res, `${c} is required.`);
      const use = cols.filter((c) => req.body[c] !== undefined);
      const vals = use.map((c) => (jsonCols.includes(c) ? JSON.stringify(req.body[c]) : clean(req.body[c])));
      const r = await query(`INSERT INTO ${table} (${use.join(',')}) VALUES (${use.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
      res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { next(e); }
  },
  update: async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) return bad(res, 'Not found.', 404);
      const use = cols.filter((c) => req.body[c] !== undefined);
      if (!use.length) return bad(res, 'Nothing to update.');
      const vals = use.map((c) => (jsonCols.includes(c) ? JSON.stringify(req.body[c]) : clean(req.body[c])));
      const r = await query(`UPDATE ${table} SET ${use.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${use.length + 1} RETURNING *`, [...vals, req.params.id]);
      if (!r.rows.length) return bad(res, 'Not found.', 404);
      res.json({ success: true, data: r.rows[0] });
    } catch (e) { next(e); }
  },
  remove: async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) return bad(res, 'Not found.', 404);
      const r = await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      if (!r.rowCount) return bad(res, 'Not found.', 404);
      res.json({ success: true });
    } catch (e) {
      if (e.code === '23503') return bad(res, 'This item is in use and cannot be deleted. Deactivate it instead.', 409);
      next(e);
    }
  },
});

exports.plans = crud('business_plans',
  ['code', 'audience', 'name', 'name_ar', 'description', 'description_ar', 'price_omr', 'period_months', 'features', 'boosts_listing', 'is_active'],
  { order: 'audience, price_omr', requiredCols: ['code', 'audience', 'name', 'price_omr'], jsonCols: ['features'] });
exports.ads = crud('ads',
  ['business_id', 'title', 'title_ar', 'body', 'body_ar', 'image_url', 'link_url', 'placement', 'starts_at', 'ends_at', 'is_active'], { requiredCols: ['title'] });
exports.products = crud('trip_products',
  ['title', 'title_ar', 'description', 'description_ar', 'itinerary_text', 'itinerary_text_ar', 'duration_days', 'price_omr', 'is_active'],
  { requiredCols: ['title', 'price_omr'] });
exports.trails = crud('learning_trails', ['title', 'title_ar', 'description', 'description_ar', 'sort_order', 'is_active'],
  { order: 'sort_order, created_at', requiredCols: ['title'] });
exports.stops = crud('learning_stops', ['trail_id', 'destination_id', 'title', 'title_ar', 'content', 'content_ar', 'sort_order'],
  { order: 'sort_order, title', requiredCols: ['trail_id', 'title'] });
exports.questions = crud('learning_questions', ['trail_id', 'question', 'question_ar', 'options', 'correct_index', 'sort_order'],
  { order: 'sort_order, question', requiredCols: ['trail_id', 'question', 'options'], jsonCols: ['options'] });

exports.overview = async (req, res, next) => {
  try {
    await query("UPDATE subscriptions SET status='expired' WHERE status='active' AND expires_at <= NOW()");
    const one = async (sql) => (await query(sql)).rows[0];
    const [biz, subs, rev, bk, com, ad, ord] = await Promise.all([
      one("SELECT COUNT(*) FILTER (WHERE status='pending') AS pending, COUNT(*) FILTER (WHERE status='approved') AS approved FROM businesses"),
      one("SELECT COUNT(*) FILTER (WHERE status='active') AS active, COUNT(*) FILTER (WHERE status='pending_payment') AS awaiting_payment FROM subscriptions"),
      one("SELECT COALESCE(SUM(amount_omr) FILTER (WHERE status='paid'),0) AS paid_omr, COUNT(*) FILTER (WHERE status='pending') AS pending_count FROM payments"),
      one("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='pending') AS pending, COUNT(*) FILTER (WHERE status='completed') AS completed FROM bookings"),
      one("SELECT COALESCE(SUM(commission_omr) FILTER (WHERE commission_status='due'),0) AS due_omr, COALESCE(SUM(commission_omr) FILTER (WHERE commission_status='settled'),0) AS settled_omr FROM bookings"),
      one("SELECT COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks, COUNT(*) FILTER (WHERE is_active) AS active FROM ads"),
      one("SELECT COUNT(*) FILTER (WHERE status='pending_payment') AS pending, COUNT(*) FILTER (WHERE status='paid') AS paid FROM orders"),
    ]);
    res.json({ success: true, data: { businesses: biz, subscriptions: subs, payments: rev, bookings: bk, commissions: com, ads: ad, orders: ord } });
  } catch (e) { next(e); }
};

exports.listBusinesses = async (req, res, next) => {
  try {
    const params = []; let where = '';
    if (req.query.status) { params.push(req.query.status); where = 'WHERE b.status = $1'; }
    const r = await query(
      `SELECT b.*, u.username AS owner_name, u.email AS owner_email FROM businesses b JOIN users u ON u.id = b.owner_id
       ${where} ORDER BY (b.status = 'pending') DESC, b.created_at DESC`, params);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};
exports.setBusinessStatus = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Not found.', 404);
    const { status, admin_note, is_featured } = req.body;
    if (status && !['pending', 'approved', 'rejected', 'suspended'].includes(status)) return bad(res, 'Invalid status.');
    const r = await query(
      `UPDATE businesses SET status = COALESCE($1, status), admin_note = COALESCE($2, admin_note),
              is_featured = COALESCE($3, is_featured), updated_at = NOW() WHERE id = $4 RETURNING *`,
      [status || null, admin_note ?? null, typeof is_featured === 'boolean' ? is_featured : null, req.params.id]);
    if (!r.rows.length) return bad(res, 'Not found.', 404);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.listSubscriptions = async (req, res, next) => {
  try {
    await query("UPDATE subscriptions SET status='expired' WHERE status='active' AND expires_at <= NOW()");
    const r = await query(
      `SELECT s.*, p.name AS plan_name, p.audience, p.period_months, u.username, u.email, b.name AS business_name
       FROM subscriptions s JOIN business_plans p ON p.id = s.plan_id JOIN users u ON u.id = s.user_id
       LEFT JOIN businesses b ON b.id = s.business_id ORDER BY s.created_at DESC LIMIT 200`);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};
exports.activateSubscription = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Not found.', 404);
    const s = (await query(`SELECT s.*, p.period_months FROM subscriptions s JOIN business_plans p ON p.id = s.plan_id WHERE s.id = $1`, [req.params.id])).rows[0];
    if (!s) return bad(res, 'Not found.', 404);
    if (s.status !== 'pending_payment') return bad(res, 'Only subscriptions awaiting payment can be activated.', 409);
    await query(
      `UPDATE payments SET status='paid', paid_at=NOW(), provider_ref=COALESCE($2, provider_ref), note=COALESCE($3, note)
       WHERE kind='subscription' AND ref_id=$1 AND status='pending'`, [s.id, req.body.provider_ref || null, req.body.note || null]);
    const r = await query(
      `UPDATE subscriptions SET status='active', started_at=NOW(), expires_at=NOW() + ($1::text || ' months')::interval WHERE id=$2 RETURNING *`,
      [s.period_months, s.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};
exports.cancelSubscription = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Not found.', 404);
    const r = await query("UPDATE subscriptions SET status='cancelled' WHERE id=$1 AND status IN ('pending_payment','active') RETURNING *", [req.params.id]);
    if (!r.rows.length) return bad(res, 'Not found or already closed.', 404);
    await query("UPDATE payments SET status='failed' WHERE kind='subscription' AND ref_id=$1 AND status='pending'", [req.params.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.listOrders = async (req, res, next) => {
  try {
    const r = await query(
      `SELECT o.*, t.title, u.username, u.email FROM orders o JOIN trip_products t ON t.id = o.product_id
       JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 200`);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};
exports.markOrderPaid = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Not found.', 404);
    const r = await query("UPDATE orders SET status='paid', paid_at=NOW() WHERE id=$1 AND status='pending_payment' RETURNING *", [req.params.id]);
    if (!r.rows.length) return bad(res, 'Only orders awaiting payment can be marked paid.', 409);
    await query(`UPDATE payments SET status='paid', paid_at=NOW(), provider_ref=COALESCE($2, provider_ref) WHERE kind='order' AND ref_id=$1 AND status='pending'`,
      [req.params.id, req.body.provider_ref || null]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.listBookings = async (req, res, next) => {
  try {
    const params = []; let where = '';
    if (req.query.status) { params.push(req.query.status); where = 'WHERE k.status = $1'; }
    const r = await query(
      `SELECT k.*, b.name AS business_name, u.username FROM bookings k JOIN businesses b ON b.id = k.business_id
       JOIN users u ON u.id = k.user_id ${where} ORDER BY k.created_at DESC LIMIT 300`, params);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};
exports.commissions = async (req, res, next) => {
  try {
    const r = await query(
      `SELECT b.id AS business_id, b.name AS business_name, COUNT(*) FILTER (WHERE k.status='completed') AS completed_bookings,
              COALESCE(SUM(k.amount_omr) FILTER (WHERE k.status='completed'),0) AS booking_value_omr,
              COALESCE(SUM(k.commission_omr) FILTER (WHERE k.commission_status='due'),0) AS due_omr,
              COALESCE(SUM(k.commission_omr) FILTER (WHERE k.commission_status='settled'),0) AS settled_omr
       FROM bookings k JOIN businesses b ON b.id = k.business_id GROUP BY b.id, b.name
       HAVING COUNT(*) FILTER (WHERE k.status='completed') > 0 ORDER BY due_omr DESC`);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};
exports.settleCommissions = async (req, res, next) => {
  try {
    if (!isUuid(req.params.businessId)) return bad(res, 'Not found.', 404);
    const r = await query("UPDATE bookings SET commission_status='settled', updated_at=NOW() WHERE business_id=$1 AND commission_status='due'", [req.params.businessId]);
    res.json({ success: true, settled_bookings: r.rowCount });
  } catch (e) { next(e); }
};

const readSettings = async () => ({
  commission_rate_percent: await getSetting('commission_rate_percent', '0'),
  payment_instructions: await getSetting('payment_instructions', ''),
});
exports.getSettings = async (req, res, next) => { try { res.json({ success: true, data: await readSettings() }); } catch (e) { next(e); } };
exports.putSettings = async (req, res, next) => {
  try {
    if (req.body.commission_rate_percent !== undefined) {
      const n = Number(req.body.commission_rate_percent);
      if (!(n >= 0 && n <= 100)) return bad(res, 'Commission rate must be between 0 and 100.');
      await query(`INSERT INTO app_settings (key,value) VALUES ('commission_rate_percent',$1) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`, [String(n)]);
    }
    if (req.body.payment_instructions !== undefined) {
      await query(`INSERT INTO app_settings (key,value) VALUES ('payment_instructions',$1) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
        [String(req.body.payment_instructions).slice(0, 2000)]);
    }
    res.json({ success: true, data: await readSettings() });
  } catch (e) { next(e); }
};
