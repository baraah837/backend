// routes/recommendationRoutes.js
const router = require('express').Router();
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/recommendationController');

router.get('/',         optionalAuth, ctrl.getRecommendations);
router.get('/trending', ctrl.getTrending);

module.exports = router;
