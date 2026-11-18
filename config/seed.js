// config/seed.js  –  Seed initial data (destinations, admin, chatbot config)
// Usage: node config/seed.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('./db');

async function seed() {
  try {
    console.log('[INFO] Seeding database...');

    // ── Admin user ──────────────────────────────────────────────
    const adminHash = await bcrypt.hash('Admin@123', 12);
    await query(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('admin', 'admin@misfar.om', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash]);
    console.log('  [OK] Admin user created  (admin@misfar.om / Admin@123)');

    // ── Destinations ────────────────────────────────────────────
    const destinations = [
      { name: 'Suq Nizwa',         area: 'Nizwa',              region: 'Al Dakhiliya', category: 'Historic',
        overview: "Nizwa Souq is one of Oman's most iconic traditional markets beside Nizwa Fort.",
        opening_hours: 'Daily 8:00 AM – 6:00 PM', entry_fee: 0, map_link: 'https://maps.app.goo.gl/1ftmZ7yNhmAxNbMe6', latitude: 22.9333, longitude: 57.5333 },
      { name: 'Musandam',          area: 'Khasab',             region: 'Musandam',     category: 'Nature',
        overview: 'Famous for dramatic fjord-like inlets, crystal-clear waters, and dhow cruises.',
        opening_hours: 'Open all day', entry_fee: 0, map_link: 'https://maps.app.goo.gl/UH3zYkoPQpkhExYWA', latitude: 26.1833, longitude: 56.2500 },
      { name: 'Salalah',           area: 'Salalah',            region: 'Dhofar',       category: 'Nature',
        overview: 'Transforms into a lush green paradise during the Khareef season.',
        opening_hours: 'Open all day', entry_fee: 0, map_link: 'https://maps.app.goo.gl/6cgdp5cRFSecbjbL7', latitude: 17.0151, longitude: 54.0924 },
      { name: 'Muttrah Corniche',  area: 'Muscat',             region: 'Muscat',       category: 'Historic',
        overview: 'Combines traditional souqs with a beautiful seaside promenade.',
        opening_hours: 'Daily 8:00 AM – 11:00 PM', entry_fee: 0, map_link: 'https://maps.app.goo.gl/jpnhuPcovQPM98yK6', latitude: 23.6198, longitude: 58.5940 },
      { name: 'Jabal Shams',       area: 'Al Dakhiliya',       region: 'Al Dakhiliya', category: 'Adventure',
        overview: 'Highest mountain in Oman with breathtaking canyon views and hiking trails.',
        opening_hours: 'Open all day', entry_fee: 0, map_link: 'https://maps.app.goo.gl/kVaPnhoVaDkf6Hux6', latitude: 23.2500, longitude: 57.1500 },
      { name: 'Jabal Al Akhdar',   area: 'Al Dakhiliya',       region: 'Al Dakhiliya', category: 'Nature',
        overview: 'Cool temperatures, terraced villages, and famous rose gardens.',
        opening_hours: 'Open all day', entry_fee: 0, map_link: 'https://maps.app.goo.gl/LRAy1oJEFrXkun5e7', latitude: 23.1667, longitude: 57.4833 },
      { name: 'Turtle Beach',      area: 'South Al Sharqiya',  region: 'Al Sharqiya',  category: 'Nature',
        overview: 'Famous turtle reserve where visitors can watch sea turtles nesting.',
        opening_hours: 'Nightly tours 9:00 PM – 1:00 AM', entry_fee: 7, map_link: 'https://maps.app.goo.gl/HsckzVfJNyD9W2Ct5', latitude: 22.5667, longitude: 59.8833 },
      { name: 'Ras Al Janz',       area: 'Al Sharqiya',        region: 'Al Sharqiya',  category: 'Beach',
        overview: 'Scenic coastal views and peaceful beaches for quiet getaways.',
        opening_hours: 'Open all day', entry_fee: 0, map_link: 'https://maps.app.goo.gl/Yw8rs6esxikRKdWR9', latitude: 22.5333, longitude: 59.8000 },
      { name: 'Wadi Bani Khalid',  area: 'Al Sharqiya',        region: 'Al Sharqiya',  category: 'Nature',
        overview: 'Famous wadi with clear turquoise pools and dramatic rock formations.',
        opening_hours: 'Daily 8:00 AM – 6:00 PM', entry_fee: 0, map_link: 'https://maps.app.goo.gl/pZnEVrKR338sc6td9', latitude: 22.5000, longitude: 58.5000 },
    ];

    for (const d of destinations) {
      await query(`
        INSERT INTO destinations (name, area, region, category, overview, opening_hours, entry_fee, map_link, latitude, longitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT DO NOTHING
      `, [d.name, d.area, d.region, d.category, d.overview, d.opening_hours, d.entry_fee, d.map_link, d.latitude, d.longitude]);
    }
    console.log(`  [OK] ${destinations.length} destinations seeded`);

    // ── Chatbot config ──────────────────────────────────────────
    const configs = [
      { key: 'welcome_message',    value: 'Welcome to Misfar! I\'m your Oman travel assistant. Ask me about destinations, activities, or trip planning!', description: 'Chatbot greeting message' },
      { key: 'fallback_message',   value: 'I\'m not sure about that. Would you like me to suggest popular destinations in Oman?', description: 'Fallback when bot cannot answer' },
      { key: 'max_suggestions',    value: '3', description: 'Max destination suggestions per chatbot response' },
      { key: 'chatbot_name',       value: 'Misfar Assistant', description: 'Display name of the chatbot' },
      { key: 'is_active',          value: 'true', description: 'Enable/disable chatbot globally' },
    ];

    for (const c of configs) {
      await query(`
        INSERT INTO chatbot_config (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [c.key, c.value, c.description]);
    }
    console.log(`  [OK] ${configs.length} chatbot config entries seeded`);

    console.log('\n[DONE] Database seeding complete!');
  } catch (err) {
    console.log('[ERROR] Seeding failed');
    console.log('[ERROR] Message :', err.message);
    console.log('[ERROR] Code    :', err.code);
    console.log('[ERROR] Detail  :', err.detail || 'none');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
