/* auth*/
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/errorHandler');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.post('/register', [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required.')
    .isLength({ min: 2, max: 50 }).withMessage('Username must be 2–50 characters.'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .custom(val => {
      // Simple email check — more permissive than isEmail()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) throw new Error('Valid email required.');
      return true;
    }),
  body('password')
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
], validate, ctrl.register);

router.post('/login', [
  body('email').trim().notEmpty().withMessage('Email is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
], validate, ctrl.login);

router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);

module.exports = router;
