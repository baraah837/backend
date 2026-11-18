// controllers/chatbotController.js
const { query } = require('../config/db');

// ── Simple keyword-based chatbot engine ───────────────────────
const RESPONSES = {
  greeting:  ['hello','hi','hey','salam','مرحبا','صباح','مساء'],
  farewell:  ['bye','goodbye','thank','thanks','شكرا','وداع'],
  muscat:    ['muscat','مسقط','capital','grand mosque','opera'],
  nizwa:     ['nizwa','نزوى','fort','souq','market','nizwa fort'],
  salalah:   ['salalah','صلالة','khareef','monsoon','dhofar'],
  musandam:  ['musandam','مسندم','fjord','diving','khasab'],
  jabal:     ['jabal','جبل','mountain','akhdar','shams'],
  wadi:      ['wadi','وادي','khalid','swimming','pool'],
  turtle:    ['turtle','ras al jinz','jinz','janz'],
  muttrah:   ['muttrah','corniche','مطرح'],
  trip:      ['trip','plan','itinerary','رحلة','خطة'],
  weather:   ['weather','climate','temperature','hot','rain','best time'],
  food:      ['food','eat','restaurant','cuisine','حلوى','shuwa','harees'],
  budget:    ['cheap','budget','cost','price','afford','expensive'],
  help:      ['help','how','what','where','when','?'],
};

const getBotReply = async (message) => {
  const lower = (message || '').toLowerCase();

  if (RESPONSES.greeting.some(k => lower.includes(k)))
    return '👋 Welcome to Misfar! I\'m your Oman travel assistant. Ask me about destinations, weather, food, or trip planning!';
  if (RESPONSES.farewell.some(k => lower.includes(k)))
    return 'You\'re welcome! Have a wonderful trip in Oman! 🌟 Safe travels!';
  if (RESPONSES.musandam.some(k => lower.includes(k)))
    return '🏔 Musandam — "The Norway of Arabia" — is famous for its stunning fjords and crystal-clear waters. Best visited October–April. Great for dhow cruises, snorkeling, and dolphin watching!';
  if (RESPONSES.nizwa.some(k => lower.includes(k)))
    return '🏛 Nizwa Souq is open daily 8AM–6PM. Friday mornings feature a traditional goat market. Don\'t miss the silver jewelry, khanjars (daggers), and dates! Nizwa Fort is open 9AM–4PM (closed Mondays).';
  if (RESPONSES.salalah.some(k => lower.includes(k)))
    return '🌿 Salalah transforms into a lush green paradise during Khareef season (July–September). Flights from Muscat are ~1.5 hours. Visit Wadi Darbat, Mughsail Beach, and the frankincense souq!';
  if (RESPONSES.jabal.some(k => lower.includes(k)))
    return '⛰ Jabal Al Akhdar offers cool temperatures, terraced villages, and rose gardens. Jabal Shams is Oman\'s highest peak with a breathtaking "Grand Canyon" viewpoint! Best visited in winter (Nov–Feb).';
  if (RESPONSES.wadi.some(k => lower.includes(k)))
    return '💧 Wadi Bani Khalid has beautiful turquoise pools perfect for swimming. No entry fee! Bring water, sunscreen, and modest swimwear. Open year-round but best in cooler months.';
  if (RESPONSES.turtle.some(k => lower.includes(k)))
    return '🐢 Ras Al Jinz Turtle Reserve is where endangered green turtles nest. Night tours available — book in advance! Located in Al Sharqiya Governorate, about 3 hours from Muscat.';
  if (RESPONSES.muttrah.some(k => lower.includes(k)))
    return '🌊 Muttrah Corniche is a beautiful waterfront promenade with the historic Muttrah Souq. Perfect for an evening stroll! Close to the famous Mutrah Fish Market and several traditional restaurants.';
  if (RESPONSES.muscat.some(k => lower.includes(k)))
    return '🕌 Muscat is Oman\'s beautiful capital! Must-see: Sultan Qaboos Grand Mosque (closed Fridays), Muttrah Corniche, Royal Opera House, and Qurum Beach. Best visited October to April.';
  if (RESPONSES.trip.some(k => lower.includes(k)))
    return '🗺 I can help plan your trip! Try our AI Trip Generator — select your region, duration, budget, and interests for a personalized day-by-day itinerary. Or use the Trip Builder to plan manually!';
  if (RESPONSES.weather.some(k => lower.includes(k)))
    return '☀ Best time to visit Oman: October–April (pleasant 20–28°C). Summer (May–Sept) is very hot (40°C+) except Salalah which has a cool monsoon season. Always carry water when exploring!';
  if (RESPONSES.food.some(k => lower.includes(k)))
    return '🍽 Try Omani staples: Shuwa (slow-cooked lamb in an underground oven), Harees (wheat and lamb porridge), Mishkak (grilled skewers), Mashuai (grilled kingfish), and Halwa for dessert. Delicious!';
  if (RESPONSES.budget.some(k => lower.includes(k)))
    return '💰 Oman suits all budgets! Budget tips: use local restaurants (3–5 OMR/meal), take shared taxis, camp at wadis (free!), and visit free beaches. Entrance fees are usually 1–5 OMR per person.';
  if (RESPONSES.help.some(k => lower.includes(k)))
    return '🤔 I can tell you about Oman\'s destinations, best time to visit, local food, trip costs, and how to use Misfar. Try asking: "Tell me about Nizwa" or "What\'s the best time to visit Oman?"';

  return '🌍 I\'m not sure about that — but Oman has amazing places to explore! Ask me about Nizwa, Musandam, Salalah, Jabal Akhdar, or Wadi Bani Khalid, and I\'ll tell you everything you need to know!';
};

// ── POST /api/chatbot/message ─────────────────────────────────
exports.sendMessage = async (req, res, next) => {
  try {
    const { message, conversation_id } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    const botReply = await getBotReply(message);

    // Save conversation (silently ignore DB errors — chatbot still works without DB)
    let conversationId = conversation_id;
    try {
      if (!conversationId) {
        const conv = await query(`
          INSERT INTO chatbot_conversations (user_id, session_id)
          VALUES ($1, $2) RETURNING id
        `, [req.user?.id || null, `session_${Date.now()}`]);
        conversationId = conv.rows[0]?.id;
      }
      if (conversationId) {
        await query(`
          INSERT INTO chatbot_messages (conversation_id, role, content)
          VALUES ($1, 'user', $2)
        `, [conversationId, message]);
        await query(`
          INSERT INTO chatbot_messages (conversation_id, role, content)
          VALUES ($1, 'bot', $2)
        `, [conversationId, botReply]);
      }
    } catch { /* DB saving failed silently — chatbot still responds */ }

    res.json({
      success: true,
      data: { reply: botReply, conversation_id: conversationId }
    });
  } catch (err) { next(err); }
};

// ── Activities (exported from same file per route config) ─────
const activitiesQuery = query;

exports.getActivities = async (req, res, next) => {
  try {
    const result = await activitiesQuery(`
      SELECT * FROM activities WHERE is_active = TRUE ORDER BY start_date ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.createActivity = async (req, res, next) => {
  try {
    const { title, location, region, start_date, end_date, description } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title is required.' });
    const result = await activitiesQuery(`
      INSERT INTO activities (title, location, region, start_date, end_date, description, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [title, location, region, start_date || null, end_date || null, description, req.user.id]);
    res.status(201).json({ success: true, message: 'Activity created.', data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.updateActivity = async (req, res, next) => {
  try {
    const { title, location, region, start_date, end_date, description, is_active } = req.body;
    const result = await activitiesQuery(`
      UPDATE activities SET title=$1,location=$2,region=$3,start_date=$4,end_date=$5,description=$6,is_active=$7
      WHERE id=$8 RETURNING *
    `, [title, location, region, start_date || null, end_date || null, description, is_active !== false, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Activity not found.' });
    res.json({ success: true, message: 'Activity updated.', data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.deleteActivity = async (req, res, next) => {
  try {
    await activitiesQuery('UPDATE activities SET is_active = FALSE WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Activity deactivated.' });
  } catch (err) { next(err); }
};

// ── Admin: chatbot config ─────────────────────────────────────
exports.getConfig = async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM chatbot_config ORDER BY key');
    res.json({ success: true, data: r.rows });
  } catch { res.json({ success: true, data: [] }); }
};

exports.updateConfig = async (req, res, next) => {
  try {
    const { configs } = req.body;
    for (const { key, value } of configs) {
      await query(`INSERT INTO chatbot_config (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]);
    }
    res.json({ success: true, message: 'Config updated.' });
  } catch (err) { next(err); }
};

exports.getConversations = async (req, res, next) => {
  try {
    const r = await query(`
      SELECT cc.id, cc.created_at, u.username,
             COUNT(cm.id) AS message_count
      FROM chatbot_conversations cc
      LEFT JOIN users u ON u.id = cc.user_id
      LEFT JOIN chatbot_messages cm ON cm.conversation_id = cc.id
      GROUP BY cc.id, u.username
      ORDER BY cc.created_at DESC LIMIT 50
    `);
    res.json({ success: true, data: r.rows });
  } catch { res.json({ success: true, data: [] }); }
};
