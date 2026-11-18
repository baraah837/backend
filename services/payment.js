// services/payment.js – payment provider abstraction.
// Today the only provider is "manual": the user sees the payment instructions set by the admin
// (bank transfer, cash at office, ...) and the admin confirms receipt from the dashboard, which activates
// the subscription/order. To add an online gateway (e.g. Thawani) implement createCharge() for a new provider
// and select it with PAYMENT_PROVIDER in .env – the rest of the code does not change.
const { query } = require('../config/db');

const getSetting = async (key, fallback = '') => {
  const r = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return r.rows.length ? r.rows[0].value : fallback;
};

const providers = {
  manual: {
    async createCharge(payment) {
      return { provider: 'manual', status: 'pending', reference: payment.id, instructions: await getSetting('payment_instructions', '') };
    },
  },
};
const active = () => providers[process.env.PAYMENT_PROVIDER || 'manual'] || providers.manual;

const createPending = async ({ userId, kind, refId, amount }) => {
  const r = await query(
    `INSERT INTO payments (user_id, kind, ref_id, amount_omr, provider) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, kind, refId, amount, process.env.PAYMENT_PROVIDER || 'manual']);
  const charge = await active().createCharge(r.rows[0]);
  return { payment: r.rows[0], charge };
};

module.exports = { createPending, getSetting };
