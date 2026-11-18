// controllers/tripController.js
const { query, getClient } = require('../config/db');

// ── GET /api/trips  –  user's own trips ──────────────────────
exports.getMyTrips = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT t.*,
        json_agg(
          jsonb_build_object(
            'id', ts.id,
            'stop_order', ts.stop_order,
            'place', COALESCE(d.name, ts.custom_place),
            'destination_id', ts.destination_id,
            'arrival_time', ts.arrival_time,
            'duration_hours', ts.duration_hours,
            'notes', ts.notes
          ) ORDER BY ts.stop_order
        ) FILTER (WHERE ts.id IS NOT NULL) AS stops
      FROM trips t
      LEFT JOIN trip_stops ts ON ts.trip_id = t.id
      LEFT JOIN destinations d ON d.id = ts.destination_id
      WHERE t.user_id = $1
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `, [req.user.id]);

    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

// ── GET /api/trips/:id ────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT t.*,
        json_agg(
          jsonb_build_object(
            'id', ts.id,
            'stop_order', ts.stop_order,
            'place', COALESCE(d.name, ts.custom_place),
            'destination_id', ts.destination_id,
            'photo', (SELECT photo_url FROM destination_photos WHERE destination_id = d.id AND is_primary = TRUE LIMIT 1),
            'arrival_time', ts.arrival_time,
            'duration_hours', ts.duration_hours,
            'notes', ts.notes
          ) ORDER BY ts.stop_order
        ) FILTER (WHERE ts.id IS NOT NULL) AS stops
      FROM trips t
      LEFT JOIN trip_stops ts ON ts.trip_id = t.id
      LEFT JOIN destinations d ON d.id = ts.destination_id
      WHERE t.id = $1 AND t.user_id = $2
      GROUP BY t.id
    `, [req.params.id, req.user.id]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

// ── POST /api/trips  –  save a manual trip ────────────────────
exports.create = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { title, trip_date, duration_days, budget_level, travel_type, total_cost_omr, notes, stops = [] } = req.body;

    const tripResult = await client.query(`
      INSERT INTO trips (user_id, title, trip_date, duration_days, budget_level, travel_type, total_cost_omr, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [req.user.id, title, trip_date || null, duration_days || null, budget_level || null, travel_type || null, total_cost_omr || null, notes || null]);

    const trip = tripResult.rows[0];

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      await client.query(`
        INSERT INTO trip_stops (trip_id, destination_id, custom_place, stop_order, arrival_time, duration_hours, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [trip.id, s.destination_id || null, s.custom_place || null, i + 1, s.arrival_time || null, s.duration_hours || null, s.notes || null]);
    }

    // Track behavior for each destination stop
    for (const s of stops) {
      if (s.destination_id) {
        await client.query(
          `INSERT INTO user_behavior (user_id, destination_id, action) VALUES ($1,$2,'trip')`,
          [req.user.id, s.destination_id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Trip saved.', data: trip });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── PUT /api/trips/:id ────────────────────────────────────────
exports.update = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { title, trip_date, duration_days, budget_level, travel_type, total_cost_omr, notes, stops } = req.body;

    const tripResult = await client.query(`
      UPDATE trips
      SET title=$1, trip_date=$2, duration_days=$3, budget_level=$4,
          travel_type=$5, total_cost_omr=$6, notes=$7
      WHERE id=$8 AND user_id=$9
      RETURNING *
    `, [title, trip_date, duration_days, budget_level, travel_type, total_cost_omr, notes, req.params.id, req.user.id]);

    if (!tripResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    if (stops) {
      await client.query('DELETE FROM trip_stops WHERE trip_id = $1', [req.params.id]);
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        await client.query(`
          INSERT INTO trip_stops (trip_id, destination_id, custom_place, stop_order, arrival_time, duration_hours, notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [req.params.id, s.destination_id || null, s.custom_place || null, i + 1, s.arrival_time || null, s.duration_hours || null, s.notes || null]);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Trip updated.', data: tripResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── DELETE /api/trips/:id ─────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM trips WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }
    res.json({ success: true, message: 'Trip deleted.' });
  } catch (err) { next(err); }
};

// ── POST /api/trips/ai-generate ───────────────────────────────
// Generates a smart itinerary based on user preferences
exports.aiGenerate = async (req, res, next) => {
  try {
    const { region, duration, budget, interests = [], travel_type } = req.body;

    // Map interests to DB categories
    const interestMap = {
      'Beaches': 'Beach', 'Mountains': 'Nature', 'Historic': 'Historic',
      'Desert': 'Adventure', 'Adventure': 'Adventure', 'Nature': 'Nature'
    };
    const categories = [...new Set(interests.map(i => interestMap[i] || i))];

    // Fetch matching destinations from DB
    let destQuery = `
      SELECT d.id, d.name, d.area, d.region, d.category, d.avg_rating,
             d.opening_hours, d.entry_fee, d.overview,
             (SELECT photo_url FROM destination_photos WHERE destination_id = d.id AND is_primary = TRUE LIMIT 1) AS photo
      FROM destinations d
      WHERE d.is_active = TRUE
    `;
    const params = [];

    if (region) {
      params.push(region);
      destQuery += ` AND d.region = $${params.length}`;
    }
    if (categories.length) {
      params.push(categories);
      destQuery += ` AND d.category = ANY($${params.length})`;
    }

    // Budget-based filtering (entry_fee proxy)
    if (budget === 'Low')    destQuery += ' AND d.entry_fee <= 5';
    if (budget === 'Medium') destQuery += ' AND d.entry_fee <= 20';

    destQuery += ` ORDER BY d.avg_rating DESC, d.visit_count DESC LIMIT 20`;

    const destinations = await query(destQuery, params);
    const dests = destinations.rows;

    if (!dests.length) {
      return res.status(404).json({
        success: false,
        message: 'No destinations found matching your preferences. Try different filters.'
      });
    }

    // Build day-by-day itinerary
    const days = parseInt(duration) || 2;
    const stopsPerDay = 2;
    const itinerary = [];
    const usedIds = new Set();

    // Estimate budget
    const transportCostPerDay = budget === 'Low' ? 10 : budget === 'Medium' ? 25 : 50;
    let totalCost = 0;

    for (let day = 1; day <= days; day++) {
      const dayStops = [];
      const times = ['8:00 AM', '11:00 AM', '2:00 PM', '5:00 PM'];

      for (let s = 0; s < stopsPerDay && dests.length; s++) {
        const available = dests.filter(d => !usedIds.has(d.id));
        if (!available.length) break;

        const dest = available[0];
        usedIds.add(dest.id);
        totalCost += parseFloat(dest.entry_fee || 0);

        dayStops.push({
          time: times[s],
          destination: dest,
          duration: '2-3 hours',
          notes: dest.opening_hours ? `Open: ${dest.opening_hours}` : null
        });
      }

      // Add meal break
      dayStops.push({
        time: '1:00 PM',
        destination: null,
        custom_place: 'Lunch / Local Restaurant',
        duration: '1 hour',
        notes: 'Enjoy local Omani cuisine'
      });

      totalCost += transportCostPerDay;
      itinerary.push({ day, stops: dayStops.sort((a, b) => a.time > b.time ? 1 : -1) });
    }

    res.json({
      success: true,
      data: {
        itinerary,
        summary: {
          days,
          region: region || 'Multiple Regions',
          budget,
          travel_type,
          estimated_cost_omr: parseFloat(totalCost.toFixed(3)),
          destinations_count: usedIds.size
        }
      }
    });
  } catch (err) { next(err); }
};
