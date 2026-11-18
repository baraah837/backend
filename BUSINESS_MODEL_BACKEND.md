# Misfar backend – business-model additions

**Nothing existing was changed.** Differences from your original backend:

| File | Change |
|---|---|
| `server.js` | +4 lines: two `require` and two `app.use` (mounts the new routers) |
| `package.json` | +1 script: `db:migrate:business` |
| `config/migrate_business.js` | NEW – creates only new tables (`IF NOT EXISTS`, safe to run many times) |
| `services/payment.js` | NEW – payment provider layer |
| `controllers/businessController.js`, `controllers/businessAdminController.js` | NEW |
| `routes/businessRoutes.js` (mounted at `/api`), `routes/businessAdminRoutes.js` (mounted at `/api/admin-biz`) | NEW |

Existing tables, routes and responses are untouched. `.env` and `node_modules` are NOT in this zip – keep yours.

## Install
    npm install
    node config/migrate_business.js      # or: npm run db:migrate:business   (run once; repeatable)
    npm start

## New tables
app_settings, businesses, business_plans, subscriptions, payments, bookings, ads, trip_products, orders,
learning_trails, learning_stops, learning_questions.

## How each revenue stream works
| Stream (canvas) | How it works |
|---|---|
| Monthly subscriptions for hotels/restaurants | Owner lists a business → admin approves → owner picks a plan (admin creates plans & prices) → admin confirms payment → plan is active for N months. Plans with "promotes listing" put the business first in the directory. |
| Commission on bookings | Traveller sends a request → owner confirms → on completion the owner enters the final amount → commission = amount × rate (rate set in admin Settings, stored on the booking) → admin sees what each business owes and marks it received. |
| In-app ads | Admin creates ads (title, image URL, link, dates, placement). Views and clicks are counted. |
| Premium for travellers | A plan with audience "tourist". While active: no ads + every trip plan unlocked. |
| Selling smart trip plans | Admin writes plans (teaser is public, full itinerary only after payment). Free plans open immediately. |
| Marketing partnerships | Partners page (email) + paid ads / promoted listings above. |

Learning content (trails, stops, quiz) is now editable from the admin dashboard.

## Payments – important
No prices are pre-filled: you create the plans and prices. Payment is **manual confirmation**: after subscribing/ordering,
the user sees the "Payment instructions" you write in admin → Business model → Settings (bank transfer, office, ...);
when the money arrives you press "Confirm payment" and the subscription/order activates.
To use an online gateway (e.g. Thawani): add a provider in `services/payment.js` (`createCharge`) and a webhook that calls
the same activation logic; select it with `PAYMENT_PROVIDER` in `.env`. This needs a merchant account – not included.

## API summary
Public/user (`/api`): GET /businesses, /businesses/:id, /plans, /ads, /products, /products/:id, /learning, /public-settings;
auth: POST /businesses, PUT /businesses/:id, POST /businesses/:id/photo, GET /businesses/mine/list, GET /businesses/:id/bookings,
POST /subscriptions, GET /subscriptions/me, POST /bookings, GET /bookings/me, PUT /bookings/:id/cancel, PUT /bookings/:id/status,
POST /products/:id/order, GET /orders/me; POST /ads/:id/impression|click.
Admin (`/api/admin-biz`, admin only): overview, businesses, plans, subscriptions, orders, bookings, commissions, ads, products,
learning/trails|stops|questions, settings.

## Tested
64 automated API checks (permissions, validation, commission maths, premium ad-free, locked itineraries, idempotency) plus a
21-step browser test (admin + owner + traveller, phone and desktop, Arabic) on PostgreSQL 16.

## Note
The API limiter allows 200 requests / 15 min per IP (existing setting). The home page now makes a few more calls
(recommendations, trending, ads); normal use is fine, raise `max` in `server.js` if many users share one IP (e.g. a campus).
