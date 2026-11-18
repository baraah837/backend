// routes/businessRoutes.js – NEW public/user routes for the business model. Mounted at /api.
const router = require('express').Router();
const { protect, optionalAuth } = require('../middleware/auth');
const { uploadDestinationPhoto } = require('../middleware/upload');
const c = require('../controllers/businessController');

router.get('/businesses',               optionalAuth, c.listBusinesses);
router.get('/businesses/mine/list',     protect, c.myBusinesses);
router.get('/businesses/:id',           optionalAuth, c.getBusiness);
router.post('/businesses',              protect, c.createBusiness);
router.put('/businesses/:id',           protect, c.updateBusiness);
router.post('/businesses/:id/photo',    protect, uploadDestinationPhoto, c.uploadBusinessPhoto);
router.get('/businesses/:id/bookings',  protect, c.businessBookings);

router.get('/plans',                    c.listPlans);
router.post('/subscriptions',           protect, c.subscribe);
router.get('/subscriptions/me',         protect, c.mySubscriptions);

router.post('/bookings',                protect, c.createBooking);
router.get('/bookings/me',              protect, c.myBookings);
router.put('/bookings/:id/cancel',      protect, c.cancelBooking);
router.put('/bookings/:id/status',      protect, c.setBookingStatus);

router.get('/ads',                      optionalAuth, c.listAds);
router.post('/ads/:id/impression',      c.adImpression);
router.post('/ads/:id/click',           c.adClick);

router.get('/products',                 optionalAuth, c.listProducts);
router.get('/products/:id',             optionalAuth, c.getProduct);
router.post('/products/:id/order',      protect, c.orderProduct);
router.get('/orders/me',                protect, c.myOrders);

router.get('/learning',                 c.learning);
router.get('/public-settings',          c.publicSettings);

module.exports = router;
