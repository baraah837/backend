// config/migrate.js  –  Run this once to create all tables
// Usage: node config/migrate.js

require('dotenv').config();
const { query, pool } = require('./db');

const schema = `

-- ════════════════════════════════════════════════════════
--  EXTENSIONS
-- ════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for fuzzy text search

-- ════════════════════════════════════════════════════════
--  ENUM TYPES
-- ════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE user_role      AS ENUM ('user', 'admin');
  CREATE TYPE budget_level   AS ENUM ('Low', 'Medium', 'High');
  CREATE TYPE travel_type    AS ENUM ('Solo', 'Family', 'Friends', 'Couple');
  CREATE TYPE comment_status AS ENUM ('pending', 'approved', 'rejected');
  CREATE TYPE notif_status   AS ENUM ('sent', 'draft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ════════════════════════════════════════════════════════
--  USERS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          user_role    NOT NULL DEFAULT 'user',
  location      VARCHAR(100) DEFAULT 'Muscat, Oman',
  interests     VARCHAR(100) DEFAULT 'Nature, Beaches',
  budget        budget_level DEFAULT 'Low',
  travel_type   travel_type  DEFAULT 'Solo',
  photo_url     VARCHAR(500),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  DESTINATIONS (Tourist Attractions)
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS destinations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(150) NOT NULL,
  area          VARCHAR(100) NOT NULL,
  region        VARCHAR(100) NOT NULL,   -- e.g. Muscat, Dhofar, Al Dakhiliya
  category      VARCHAR(50)  NOT NULL,   -- e.g. Nature, Historic, Beach
  overview      TEXT,
  opening_hours VARCHAR(200),
  entry_fee     DECIMAL(8,3),            -- in OMR
  map_link      VARCHAR(500),
  latitude      DECIMAL(10,7),
  longitude     DECIMAL(10,7),
  avg_rating    DECIMAL(3,2) DEFAULT 0,
  visit_count   INTEGER      DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- Full-text search index on name + area
CREATE INDEX IF NOT EXISTS idx_dest_search ON destinations USING gin(
  (to_tsvector('english', name || ' ' || area || ' ' || region || ' ' || category))
);

-- ════════════════════════════════════════════════════════
--  DESTINATION PHOTOS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS destination_photos (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  photo_url      VARCHAR(500) NOT NULL,
  caption        VARCHAR(255),
  is_primary     BOOLEAN DEFAULT FALSE,
  uploaded_by    UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  REVIEWS & COMMENTS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  rating         SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  sentiment_score DECIMAL(4,3),           -- AI: -1.0 to 1.0
  sentiment_label VARCHAR(20),            -- 'positive','neutral','negative'
  status         comment_status NOT NULL DEFAULT 'pending',
  admin_note     VARCHAR(500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, destination_id)        -- one review per user per destination
);
CREATE INDEX IF NOT EXISTS idx_reviews_dest ON reviews(destination_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

-- ════════════════════════════════════════════════════════
--  BOOKMARKS (Saved Places)
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bookmarks (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, destination_id)
);

-- ════════════════════════════════════════════════════════
--  TRIPS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS trips (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          VARCHAR(150) NOT NULL,
  trip_date      DATE,
  duration_days  SMALLINT,
  budget_level   budget_level,
  travel_type    travel_type,
  is_ai_generated BOOLEAN DEFAULT FALSE,
  total_cost_omr DECIMAL(10,3),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  TRIP STOPS (stops / itinerary within a trip)
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS trip_stops (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id        UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  destination_id UUID REFERENCES destinations(id),
  custom_place   VARCHAR(150),            -- for free-text stops not in DB
  stop_order     SMALLINT NOT NULL,
  arrival_time   TIME,
  duration_hours DECIMAL(4,1),
  notes          VARCHAR(500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  ACTIVITIES / EVENTS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       VARCHAR(200) NOT NULL,
  location    VARCHAR(200),
  region      VARCHAR(100),
  start_date  DATE,
  end_date    DATE,
  description TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  NOTIFICATIONS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       VARCHAR(200) NOT NULL,
  message     TEXT NOT NULL,
  type        VARCHAR(50) DEFAULT 'offer',   -- 'offer','suggestion','alert'
  target_all  BOOLEAN DEFAULT TRUE,
  status      notif_status DEFAULT 'draft',
  sent_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  NOTIFICATION READS (per-user read receipts)
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notification_reads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (notification_id, user_id)
);

-- ════════════════════════════════════════════════════════
--  CHATBOT CONFIG
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_config (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key          VARCHAR(100) NOT NULL UNIQUE,   -- e.g. 'welcome_message'
  value        TEXT NOT NULL,
  description  VARCHAR(300),
  updated_by   UUID REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  CHATBOT CONVERSATIONS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_conversations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chatbot_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL CHECK (role IN ('user','bot')),
  message         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  USER BEHAVIOR (for AI recommendation)
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_behavior (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  action         VARCHAR(30) NOT NULL,    -- 'view','bookmark','trip','review'
  duration_sec   INTEGER,                -- how long they viewed the page
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_behavior_user ON user_behavior(user_id);
CREATE INDEX IF NOT EXISTS idx_behavior_dest ON user_behavior(destination_id);

-- ════════════════════════════════════════════════════════
--  REFRESH TOKENS
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(500) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════
--  TRIGGERS: auto-update updated_at
-- ════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'users','destinations','reviews','trips','activities','chatbot_config'
]) LOOP
  EXECUTE format('
    DROP TRIGGER IF EXISTS trg_updated_%1$s ON %1$s;
    CREATE TRIGGER trg_updated_%1$s
    BEFORE UPDATE ON %1$s
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();', t);
END LOOP; END $$;

`;

async function migrate() {
  try {
    console.log('[INFO] Running database migration...');
    await query(schema);
    console.log('[OK] Migration completed successfully!');
    console.log('[INFO] Tables created:');
    const tables = await query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    tables.rows.forEach(r => console.log('   -', r.tablename));
  } catch (err) {
    console.log('[ERROR] Migration failed');
    console.log('[ERROR] Message :', err.message);
    console.log('[ERROR] Code    :', err.code);
    console.log('[ERROR] Detail  :', err.detail || 'none');
    console.log('[ERROR] Hint    :', err.hint || 'none');
    console.log('');
    console.log('--- Common fixes ---');
    console.log('1. Make sure PostgreSQL is running');
    console.log('2. Make sure the database exists: CREATE DATABASE misfar_db;');
    console.log('3. Check your .env file: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
