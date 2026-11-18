// controllers/businessController.js – NEW endpoints for the business model (additive; no existing endpoint touched)
const { query } = require('../config/db');
const { createPending, getSetting } = require('../services/payment');

const bad = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

const isPremium = async (userId) => {
  if (!userId) return false;
  const r = await query(
    `SELECT 1 FROM subscriptions s JOIN business_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND p.audience = 'tourist' AND s.status = 'active' AND s.expires_at > NOW() LIMIT 1`, [userId]);
  return r.rows.length > 0;
};

const BUSINESS_FIELDS = ['type', 'name', 'name_ar', 'description', 'description_ar', 'region', 'area', 'phone',
  'email', 'website', 'map_link', 'latitude', 'longitude', 'price_from_omr'];
const NUMERIC_FIELDS = ['latitude', 'longitude', 'price_from_omr'];
const TYPES = ['hotel', 'restaurant', 'cafe', 'tour', 'other'];

const PROMOTED_SQL = `(b.is_featured OR EXISTS (
  SELECT 1 FROM subscriptions s JOIN business_plans p ON p.id = s.plan_id
  WHERE s.business_id = b.id AND s.status = 'active' AND s.expires_at > NOW() AND p.boosts_listing))`;

// ── Businesses ────────────────────────────────────────────────
exports.listBusinesses = async (req, res, next) => {
  try {
    const { type, region, search, page = 1, limit = 20 } = req.query;
    const params = []; let where = "WHERE b.status = 'approved'";
    if (type) { params.push(type); where += ` AND b.type = $${params.length}`; }
    if (region) { params.push(region); where += ` AND b.region = $${params.length}`; }
    if (search) { params.push(`%${search}%`); where += ` AND (b.name ILIKE $${params.length} OR b.name_ar ILIKE $${params.length} OR b.area ILIKE $${params.length})`; }
    const lim = Math.min(parseInt(limit) || 20, 50); const off = ((parseInt(page) || 1) - 1) * lim;
    params.push(lim, off);
    const r = await query(
      `SELECT b.id, b.type, b.name, b.name_ar, b.description, b.description_ar, b.region, b.area, b.phone, b.website,
              b.map_link, b.latitude, b.longitude, b.photo_url, b.price_from_omr, ${PROMOTED_SQL} AS is_promoted
       FROM businesses b ${where} ORDER BY is_promoted DESC, b.name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};

exports.myBusinesses = async (req, res, next) => {
  try {
    const r = await query(`SELECT b.*, ${PROMOTED_SQL} AS is_promoted FROM businesses b WHERE b.owner_id = $1 ORDER BY b.created_at DESC`, [req.user.id]);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};

exports.getBusiness = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Business not found.', 404);
    const b = (await query(`SELECT b.*, ${PROMOTED_SQL} AS is_promoted FROM businesses b WHERE b.id = $1`, [req.params.id])).rows[0];
    if (!b) return bad(res, 'Business not found.', 404);
    const mine = req.user && (req.user.id === b.owner_id || req.user.role === 'admin');
    if (b.status !== 'approved' && !mine) return bad(res, 'Business not found.', 404);
    if (!mine) { delete b.admin_note; delete b.email; }
    res.json({ success: true, data: b });
  } catch (e) { next(e); }
};

exports.createBusiness = async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !String(b.name).trim()) return bad(res, 'Business name is required.');
    if (!TYPES.includes(b.type)) return bad(res, 'Invalid business type.');
    const cols = BUSINESS_FIELDS.filter((f) => b[f] !== undefined && b[f] !== '');
    const vals = cols.map((f) => (NUMERIC_FIELDS.includes(f) ? num(b[f]) : b[f]));
    const r = await query(
      `INSERT INTO businesses (owner_id, ${cols.join(',')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}) RETURNING *`,
      [req.user.id, ...vals]);
    res.status(201).json({ success: true, data: r.rows[0], message: 'Submitted. It will appear after admin approval.' });
  } catch (e) { next(e); }
};

const ownBusiness = async (id, user) => {
  if (!isUuid(id)) return null;
  const b = (await query('SELECT * FROM businesses WHERE id = $1', [id])).rows[0];
  if (!b || (b.owner_id !== user.id && user.role !== 'admin')) return null;
  return b;
};

exports.updateBusiness = async (req, res, next) => {
  try {
    const b = await ownBusiness(req.params.id, req.user);
    if (!b) return bad(res, 'Business not found.', 404);
    if (req.body.type && !TYPES.includes(req.body.type)) return bad(res, 'Invalid business type.');
    const cols = BUSINESS_FIELDS.filter((f) => req.body[f] !== undefined);
    if (!cols.length) return bad(res, 'Nothing to update.');
    const vals = cols.map((f) => (NUMERIC_FIELDS.includes(f) ? num(req.body[f]) : req.body[f]));
    const status = b.status === 'rejected' ? ", status = 'pending'" : '';
    const r = await query(
      `UPDATE businesses SET ${cols.map((f, i) => `${f} = $${i + 1}`).join(', ')}, updated_at = NOW()${status}
       WHERE id = $${cols.length + 1} RETURNING *`, [...vals, b.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.uploadBusinessPhoto = async (req, res, next) => {
  try {
    const b = await ownBusiness(req.params.id, req.user);
    if (!b) return bad(res, 'Business not found.', 404);
    const file = (req.files || [])[0];
    if (!file) return bad(res, 'No image uploaded.');
    const url = `/uploads/${req.uploadFolder || 'destinations'}/${file.filename}`;
    const r = await query('UPDATE businesses SET photo_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [url, b.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

// ── Plans & subscriptions ─────────────────────────────────────
exports.listPlans = async (req, res, next) => {
  try {
    const params = []; let where = 'WHERE is_active = TRUE';
    if (req.query.audience) { params.push(req.query.audience); where += ' AND audience = $1'; }
    res.json({ success: true, data: (await query(`SELECT * FROM business_plans ${where} ORDER BY price_omr ASC`, params)).rows });
  } catch (e) { next(e); }
};

exports.subscribe = async (req, res, next) => {
  try {
    const { plan_id, business_id } = req.body;
    if (!isUuid(plan_id)) return bad(res, 'plan_id is required.');
    const p = (await query('SELECT * FROM business_plans WHERE id = $1 AND is_active = TRUE', [plan_id])).rows[0];
    if (!p) return bad(res, 'Plan not found.', 404);
    let bizId = null;
    if (p.audience === 'business') {
      const b = await ownBusiness(business_id, req.user);
      if (!b || b.owner_id !== req.user.id) return bad(res, 'Choose one of your own businesses.');
      if (b.status !== 'approved') return bad(res, 'Your business must be approved before subscribing.');
      bizId = b.id;
    }
    const dup = await query(
      `SELECT 1 FROM subscriptions WHERE user_id = $1 AND plan_id = $2 AND COALESCE(business_id::text,'') = COALESCE($3::text,'')
       AND (status = 'pending_payment' OR (status = 'active' AND expires_at > NOW())) LIMIT 1`, [req.user.id, plan_id, bizId]);
    if (dup.rows.length) return bad(res, 'You already have this plan active or awaiting payment.', 409);
    const sub = (await query(
      'INSERT INTO subscriptions (user_id, business_id, plan_id, amount_omr) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, bizId, plan_id, p.price_omr])).rows[0];
    if (Number(p.price_omr) === 0) {
      const a = (await query(
        `UPDATE subscriptions SET status='active', started_at=NOW(), expires_at=NOW() + ($1::text || ' months')::interval WHERE id=$2 RETURNING *`,
        [p.period_months, sub.id])).rows[0];
      return res.status(201).json({ success: true, data: { subscription: a, payment: null } });
    }
    const { payment, charge } = await createPending({ userId: req.user.id, kind: 'subscription', refId: sub.id, amount: p.price_omr });
    res.status(201).json({ success: true, data: { subscription: sub, payment, charge } });
  } catch (e) { next(e); }
};

exports.mySubscriptions = async (req, res, next) => {
  try {
    const r = await query(
      `SELECT s.*, p.code, p.name AS plan_name, p.name_ar AS plan_name_ar, p.audience, p.period_months, b.name AS business_name,
              (s.status = 'active' AND s.expires_at > NOW()) AS is_current
       FROM subscriptions s JOIN business_plans p ON p.id = s.plan_id LEFT JOIN businesses b ON b.id = s.business_id
       WHERE s.user_id = $1 ORDER BY s.created_at DESC`, [req.user.id]);
    res.json({ success: true, data: r.rows, is_premium: await isPremium(req.user.id) });
  } catch (e) { next(e); }
};

// ── Bookings & commission ─────────────────────────────────────
exports.createBooking = async (req, res, next) => {
  try {
    const { business_id, booking_date, booking_time, guests = 1, notes, contact_phone } = req.body;
    if (!isUuid(business_id)) return bad(res, 'business_id is required.');
    const d = new Date(booking_date);
    if (!booking_date || isNaN(d)) return bad(res, 'A valid booking date is required.');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (d < today) return bad(res, 'Booking date cannot be in the past.');
    const g = parseInt(guests);
    if (!g || g < 1 || g > 500) return bad(res, 'Guests must be between 1 and 500.');
    const b = (await query("SELECT id FROM businesses WHERE id = $1 AND status = 'approved'", [business_id])).rows[0];
    if (!b) return bad(res, 'Business not found.', 404);
    const r = await query(
      `INSERT INTO bookings (user_id, business_id, booking_date, booking_time, guests, notes, contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, business_id, booking_date, booking_time || null, g, notes || null, contact_phone || null]);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.myBookings = async (req, res, next) => {
  try {
    const r = await query(
      `SELECT k.*, b.name AS business_name, b.name_ar AS business_name_ar, b.type AS business_type, b.phone AS business_phone
       FROM bookings k JOIN businesses b ON b.id = k.business_id WHERE k.user_id = $1 ORDER BY k.booking_date DESC, k.created_at DESC`, [req.user.id]);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};

exports.cancelBooking = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Booking not found.', 404);
    const r = await query(
      `UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status IN ('pending','confirmed') RETURNING *`,
      [req.params.id, req.user.id]);
    if (!r.rows.length) return bad(res, 'This booking cannot be cancelled.', 409);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.businessBookings = async (req, res, next) => {
  try {
    const b = await ownBusiness(req.params.id, req.user);
    if (!b) return bad(res, 'Business not found.', 404);
    const r = await query(
      `SELECT k.*, u.username, u.email FROM bookings k JOIN users u ON u.id = k.user_id
       WHERE k.business_id = $1 ORDER BY k.booking_date DESC, k.created_at DESC`, [b.id]);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};

// Owner moves a booking along. On "completed" the final amount is required; the platform commission
// (rate at that moment) is calculated and marked as due.
exports.setBookingStatus = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Booking not found.', 404);
    const { status, amount_omr } = req.body;
    if (!['confirmed', 'rejected', 'completed'].includes(status)) return bad(res, 'Invalid status.');
    const k = (await query(`SELECT k.*, b.owner_id FROM bookings k JOIN businesses b ON b.id = k.business_id WHERE k.id = $1`, [req.params.id])).rows[0];
    if (!k || k.owner_id !== req.user.id) return bad(res, 'Booking not found.', 404);
    const allowed = { confirmed: ['pending'], rejected: ['pending'], completed: ['confirmed'] };
    if (!allowed[status].includes(k.status)) return bad(res, `A ${k.status} booking cannot become ${status}.`, 409);
    if (status === 'completed') {
      const amt = Number(amount_omr);
      if (amount_omr === undefined || amount_omr === '' || !(amt >= 0)) return bad(res, 'The final amount (OMR) is required to complete a booking.');
      const rate = Number(await getSetting('commission_rate_percent', '0')) || 0;
      const commission = Math.round(amt * rate * 10) / 1000;   // amt * rate / 100, 3 decimals
      const r = await query(
        `UPDATE bookings SET status='completed', amount_omr=$1::numeric, commission_rate=$2::numeric, commission_omr=$3::numeric,
                commission_status = CASE WHEN $3::numeric > 0 THEN 'due' ELSE 'none' END, updated_at=NOW()
         WHERE id=$4 RETURNING *`, [amt, rate, commission, k.id]);
      return res.json({ success: true, data: r.rows[0] });
    }
    const r = await query('UPDATE bookings SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [status, k.id]);
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

// ── Ads ───────────────────────────────────────────────────────
exports.listAds = async (req, res, next) => {
  try {
    if (await isPremium(req.user?.id)) return res.json({ success: true, data: [], ad_free: true });
    const params = []; let where = `WHERE a.is_active = TRUE AND (a.starts_at IS NULL OR a.starts_at <= CURRENT_DATE)
                                    AND (a.ends_at IS NULL OR a.ends_at >= CURRENT_DATE)`;
    if (req.query.placement) { params.push(req.query.placement); where += ' AND a.placement = $1'; }
    const r = await query(
      `SELECT a.id, a.title, a.title_ar, a.body, a.body_ar, a.image_url, a.link_url, a.placement, a.business_id
       FROM ads a ${where} ORDER BY RANDOM() LIMIT 3`, params);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};
const bump = (col) => async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.json({ success: true });
    await query(`UPDATE ads SET ${col} = ${col} + 1 WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { next(e); }
};
exports.adImpression = bump('impressions');
exports.adClick = bump('clicks');

// ── Smart trip plans (store) ──────────────────────────────────
const hasAccess = async (userId, productId) => {
  if (!userId) return false;
  if (await isPremium(userId)) return true;
  return (await query("SELECT 1 FROM orders WHERE user_id=$1 AND product_id=$2 AND status='paid' LIMIT 1", [userId, productId])).rows.length > 0;
};

exports.listProducts = async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id, title, title_ar, description, description_ar, duration_days, price_omr FROM trip_products
       WHERE is_active = TRUE ORDER BY price_omr ASC, title ASC`);
    res.json({ success: true, data: r.rows, is_premium: await isPremium(req.user?.id) });
  } catch (e) { next(e); }
};

exports.getProduct = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Product not found.', 404);
    const p = (await query('SELECT * FROM trip_products WHERE id = $1 AND is_active = TRUE', [req.params.id])).rows[0];
    if (!p) return bad(res, 'Product not found.', 404);
    const unlocked = Number(p.price_omr) === 0 || req.user?.role === 'admin' || (await hasAccess(req.user?.id, p.id));
    if (!unlocked) { delete p.itinerary_text; delete p.itinerary_text_ar; }
    res.json({ success: true, data: { ...p, unlocked } });
  } catch (e) { next(e); }
};

exports.orderProduct = async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return bad(res, 'Product not found.', 404);
    const p = (await query('SELECT * FROM trip_products WHERE id = $1 AND is_active = TRUE', [req.params.id])).rows[0];
    if (!p) return bad(res, 'Product not found.', 404);
    if (await hasAccess(req.user.id, p.id)) return bad(res, 'You already have access to this plan.', 409);
    const pending = (await query("SELECT * FROM orders WHERE user_id=$1 AND product_id=$2 AND status='pending_payment'", [req.user.id, p.id])).rows[0];
    const order = pending || (await query('INSERT INTO orders (user_id, product_id, amount_omr) VALUES ($1,$2,$3) RETURNING *', [req.user.id, p.id, p.price_omr])).rows[0];
    if (!pending) var created = await createPending({ userId: req.user.id, kind: 'order', refId: order.id, amount: p.price_omr });
    const pay = created || (await (async () => {
      const pr = (await query("SELECT * FROM payments WHERE kind='order' AND ref_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [order.id])).rows[0];
      return { payment: pr, charge: { provider: 'manual', status: 'pending', instructions: await getSetting('payment_instructions', '') } };
    })());
    res.status(201).json({ success: true, data: { order, payment: pay.payment, charge: pay.charge } });
  } catch (e) { next(e); }
};

exports.myOrders = async (req, res, next) => {
  try {
    const r = await query(
      `SELECT o.*, t.title, t.title_ar FROM orders o JOIN trip_products t ON t.id = o.product_id WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [req.user.id]);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};

// ── Learning content (admin-managed) ──────────────────────────
exports.learning = async (req, res, next) => {
  try {
    const trails = (await query('SELECT * FROM learning_trails WHERE is_active = TRUE ORDER BY sort_order, created_at')).rows;
    const stops = (await query(
      `SELECT s.*, d.name AS destination_name FROM learning_stops s LEFT JOIN destinations d ON d.id = s.destination_id ORDER BY s.sort_order, s.title`)).rows;
    const qs = (await query('SELECT * FROM learning_questions ORDER BY sort_order, question')).rows;
    res.json({ success: true, data: trails.map((t) => ({ ...t, stops: stops.filter((s) => s.trail_id === t.id), questions: qs.filter((q) => q.trail_id === t.id) })) });
  } catch (e) { next(e); }
};

exports.publicSettings = async (req, res, next) => {
  try { res.json({ success: true, data: { currency: 'OMR', payment_instructions: await getSetting('payment_instructions', '') } }); } catch (e) { next(e); }
};
