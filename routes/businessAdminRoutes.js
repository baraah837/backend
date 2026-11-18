// routes/businessAdminRoutes.js – NEW admin routes. Mounted at /api/admin-biz (does not touch /api/admin).
const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const c = require('../controllers/businessAdminController');

router.use(protect, adminOnly);
router.get('/overview', c.overview);
router.get('/businesses', c.listBusinesses);
router.put('/businesses/:id/status', c.setBusinessStatus);

const mountCrud = (path, h) => {
  router.get(path, h.list); router.post(path, h.create); router.put(`${path}/:id`, h.update); router.delete(`${path}/:id`, h.remove);
};
mountCrud('/plans', c.plans);
mountCrud('/ads', c.ads);
mountCrud('/products', c.products);
mountCrud('/learning/trails', c.trails);
mountCrud('/learning/stops', c.stops);
mountCrud('/learning/questions', c.questions);

router.get('/subscriptions', c.listSubscriptions);
router.put('/subscriptions/:id/activate', c.activateSubscription);
router.put('/subscriptions/:id/cancel', c.cancelSubscription);
router.get('/orders', c.listOrders);
router.put('/orders/:id/mark-paid', c.markOrderPaid);
router.get('/bookings', c.listBookings);
router.get('/commissions', c.commissions);
router.put('/commissions/:businessId/settle', c.settleCommissions);
router.get('/settings', c.getSettings);
router.put('/settings', c.putSettings);

module.exports = router;
