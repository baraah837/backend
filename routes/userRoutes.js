// routes/userRoutes.js
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/errorHandler');
const { protect } = require('../middleware/auth');
const { uploadProfilePhoto } = require('../middleware/upload');
const userCtrl = require('../controllers/userController');

router.get('/me',          protect, userCtrl.getProfile);
router.put('/me',          protect, uploadProfilePhoto, userCtrl.updateProfile);
router.put('/me/password', protect, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
], validate, userCtrl.changePassword);

// Bookmarks
router.get('/me/bookmarks',                   protect, userCtrl.getBookmarks);
router.post('/me/bookmarks/:destinationId',   protect, userCtrl.addBookmark);
router.delete('/me/bookmarks/:destinationId', protect, userCtrl.removeBookmark);

// User's own reviews
router.get('/me/reviews',        protect, userCtrl.getMyReviews);
router.delete('/me/reviews/:id', protect, userCtrl.deleteReview);

// Notifications
router.get('/me/notifications',           protect, userCtrl.getNotifications);
router.post('/me/notifications/:id/read', protect, userCtrl.markNotificationRead);

module.exports = router;
