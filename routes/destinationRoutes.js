// routes/destinationRoutes.js
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/errorHandler');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');
const { uploadDestinationPhoto } = require('../middleware/upload');
const ctrl = require('../controllers/destinationsController');
const reviewCtrl = require('../controllers/reviewController');

// Public routes
router.get('/',    optionalAuth, ctrl.getAll);
router.get('/:id', optionalAuth, ctrl.getOne);

// Reviews per destination
router.get('/:id/reviews', reviewCtrl.getByDestination);
router.post('/:id/reviews', protect, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5.'),
  body('comment').optional().trim().isLength({ max: 1000 }),
], validate, reviewCtrl.create);

// Admin: destination CRUD
router.post('/',    protect, adminOnly, uploadDestinationPhoto, [
  body('name').trim().notEmpty(),
  body('area').trim().notEmpty(),
  body('region').trim().notEmpty(),
  body('category').trim().notEmpty(),
], validate, ctrl.create);

router.put('/:id',    protect, adminOnly, ctrl.update);
router.delete('/:id', protect, adminOnly, ctrl.remove);

// Admin: photos
router.post('/:id/photos',              protect, adminOnly, uploadDestinationPhoto, ctrl.uploadPhotos);
router.delete('/:id/photos/:photoId',   protect, adminOnly, ctrl.deletePhoto);

module.exports = router;
