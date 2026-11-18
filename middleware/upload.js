// middleware/upload.js  –  Multer configuration for photo uploads
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

// Ensure upload directories exist
['destinations', 'profiles'].forEach(dir => {
  const fullPath = path.join(UPLOAD_PATH, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// ── Storage config ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.uploadFolder || 'destinations';
    cb(null, path.join(UPLOAD_PATH, folder));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

// ── File type filter ──────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, and WEBP images are allowed.'), false);
  }
};

const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024;

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });

// ── Convenience middleware wrappers ───────────────────────────
const uploadDestinationPhoto = (req, res, next) => {
  req.uploadFolder = 'destinations';
  upload.array('photos', 10)(req, res, next);
};

const uploadProfilePhoto = (req, res, next) => {
  req.uploadFolder = 'profiles';
  upload.single('photo')(req, res, next);
};

module.exports = { uploadDestinationPhoto, uploadProfilePhoto };
