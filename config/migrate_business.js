// config/migrate_business.js – ADDITIVE migration for the business-model features.
// Creates only NEW tables (IF NOT EXISTS). Existing tables/columns are never altered.
// Usage: node config/migrate_business.js
require('dotenv').config();
const { query, pool } = require('./db');

const schema = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_settings (key, value) VALUES ('commission_rate_percent', '0'), ('payment_instructions', '')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS businesses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(20) NOT NULL DEFAULT 'hotel' CHECK (type IN ('hotel','restaurant','cafe','tour','other')),
  name          VARCHAR(150) NOT NULL,
  name_ar       VARCHAR(150),
  description   TEXT,
  description_ar TEXT,
  region        VARCHAR(100),
  area          VARCHAR(100),
  phone         VARCHAR(40),
  email         VARCHAR(255),
  website       VARCHAR(300),
  map_link      VARCHAR(500),
  latitude      DECIMAL(10,7),
  longitude     DECIMAL(10,7),
  photo_url     VARCHAR(500),
  price_from_omr DECIMAL(10,3),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  admin_note    VARCHAR(500),
  is_featured   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status, type);
CREATE INDEX IF NOT EXISTS idx_businesses_owner  ON businesses(owner_id);

CREATE TABLE IF NOT EXISTS business_plans (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(50) NOT NULL UNIQUE,
  audience      VARCHAR(10) NOT NULL CHECK (audience IN ('business','tourist')),
  name          VARCHAR(120) NOT NULL,
  name_ar       VARCHAR(120),
  description   TEXT,
  description_ar TEXT,
  price_omr     DECIMAL(10,3) NOT NULL CHECK (price_omr >= 0),
  period_months INTEGER NOT NULL DEFAULT 1 CHECK (period_months > 0),
  features      JSONB NOT NULL DEFAULT '[]',
  boosts_listing BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         VARCHAR(20) NOT NULL CHECK (kind IN ('subscription','order')),
  ref_id       UUID NOT NULL,
  amount_omr   DECIMAL(10,3) NOT NULL,
  provider     VARCHAR(30) NOT NULL DEFAULT 'manual',
  provider_ref VARCHAR(200),
  status       VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  note         VARCHAR(500),
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(kind, ref_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES business_plans(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','expired','cancelled')),
  amount_omr  DECIMAL(10,3) NOT NULL,
  started_at  TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS bookings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_date      DATE NOT NULL,
  booking_time      VARCHAR(10),
  guests            INTEGER NOT NULL DEFAULT 1 CHECK (guests > 0 AND guests <= 500),
  contact_phone     VARCHAR(40),
  notes             VARCHAR(1000),
  status            VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','cancelled','completed')),
  amount_omr        DECIMAL(10,3),
  commission_rate   DECIMAL(5,2),
  commission_omr    DECIMAL(10,3),
  commission_status VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (commission_status IN ('none','due','settled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id, status);

CREATE TABLE IF NOT EXISTS ads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  title       VARCHAR(150) NOT NULL,
  title_ar    VARCHAR(150),
  body        VARCHAR(400),
  body_ar     VARCHAR(400),
  image_url   VARCHAR(500),
  link_url    VARCHAR(500),
  placement   VARCHAR(20) NOT NULL DEFAULT 'home' CHECK (placement IN ('home','destinations','details','learn')),
  starts_at   DATE,
  ends_at     DATE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks      INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           VARCHAR(150) NOT NULL,
  title_ar        VARCHAR(150),
  description     TEXT,
  description_ar  TEXT,
  itinerary_text    TEXT,
  itinerary_text_ar TEXT,
  duration_days   INTEGER,
  price_omr       DECIMAL(10,3) NOT NULL CHECK (price_omr >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES trip_products(id),
  amount_omr DECIMAL(10,3) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','cancelled')),
  paid_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status);

CREATE TABLE IF NOT EXISTS learning_trails (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       VARCHAR(150) NOT NULL,
  title_ar    VARCHAR(150),
  description TEXT,
  description_ar TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS learning_stops (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trail_id       UUID NOT NULL REFERENCES learning_trails(id) ON DELETE CASCADE,
  destination_id UUID REFERENCES destinations(id) ON DELETE SET NULL,
  title          VARCHAR(150) NOT NULL,
  title_ar       VARCHAR(150),
  content        TEXT,
  content_ar     TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS learning_questions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trail_id      UUID NOT NULL REFERENCES learning_trails(id) ON DELETE CASCADE,
  question      VARCHAR(300) NOT NULL,
  question_ar   VARCHAR(300),
  options       JSONB NOT NULL DEFAULT '[]',
  correct_index INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
`;

(async () => {
  try {
    console.log('Running business-model migration (additive)...');
    await query(schema);
    console.log('[OK] New tables are ready.');
  } catch (err) {
    console.error('[ERROR] Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
