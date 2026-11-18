// routes/tripRoutes.js
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/errorHandler');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/tripController');

router.get('/',     protect, ctrl.getMyTrips);
router.get('/:id',  protect, ctrl.getOne);
router.post('/',    protect, [
  body('title').trim().notEmpty().withMessage('Trip title is required.'),
], validate, ctrl.create);
router.put('/:id',  protect, ctrl.update);
router.delete('/:id', protect, ctrl.remove);

// AI trip generation
router.post('/ai-generate', protect, [
  body('region').optional().isString(),
  body('duration').optional().isInt({ min: 1, max: 30 }),
  body('budget').optional().isIn(['Low', 'Medium', 'High']),
  body('interests').optional().isArray(),
], validate, ctrl.aiGenerate);

module.exports = router;
