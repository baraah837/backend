// routes/recommendationRoutes.js
const router = require('express').Router();
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/recommendationController');

router.get('/',         optionalAuth, ctrl.getRecommendations);
router.get('/trending', ctrl.getTrending);

module.exports = router;


// ─────────────────────────────────────────────────────────────
// routes/chatbotRoutes.js
// ─────────────────────────────────────────────────────────────
const chatRouter = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/errorHandler');
const { optionalAuth: optAuth } = require('../middleware/auth');
const chatCtrl = require('../controllers/chatbotController');

chatRouter.post('/message', optAuth, [
  body('message').trim().notEmpty().withMessage('Message is required.'),
], validate, chatCtrl.sendMessage);

module.exports.chatRouter = chatRouter;


// ─────────────────────────────────────────────────────────────
// routes/activitiesRoutes.js
// ─────────────────────────────────────────────────────────────
const actRouter = require('express').Router();
const { protect: prot, adminOnly: adminGuard } = require('../middleware/auth');
const actCtrl = require('../controllers/chatbotController');  // activities exported from same file

actRouter.get('/',       actCtrl.getActivities);
actRouter.post('/',      prot, adminGuard, actCtrl.createActivity);
actRouter.put('/:id',    prot, adminGuard, actCtrl.updateActivity);
actRouter.delete('/:id', prot, adminGuard, actCtrl.deleteActivity);

module.exports.actRouter = actRouter;
