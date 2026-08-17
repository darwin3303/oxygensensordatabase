const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool, types } = require("pg");

// Postgres returns BIGINT (used for movement timestamps and the sync
// version counter) as strings by default, to avoid silent precision loss
// for values beyond Number.MAX_SAFE_INTEGER. Our values never get anywhere
// close to that, and the frontend expects plain numbers, so parse them as
// numbers globally instead of doing it per-query.
types.setTypeParser(20 /* int8/bigint */, val => (val === null ? null : parseInt(val, 10)));

const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable. On Render, add a PostgreSQL database and it will be provided automatically if you link it to this service.");
  process.exit(1);
}

// Neon (and most managed Postgres providers) requires SSL for connections,
// but the certificate isn't always in Node's default trust store, so we
// relax verification the same way most providers' own docs recommend.
// (SSL is skipped only for a literal "localhost" URL, i.e. local dev.)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

const app = express();
app.use(express.json({ limit: "5mb" }));

// ---------- one-time schema setup ----------
async function ensureSchema() {
  const schemaSql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schemaSql);
  console.log("Schema ready.");
}

// ---------- helpers ----------
async function bumpVersion(client) {
  const res = await client.query(
    "UPDATE sync_meta SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version"
  );
  return res.rows[0].version;
}

async function loadFullState(db) {
  const [brands, sensors, movements, toBuy, groups, members, settingsRow, versionRow] = await Promise.all([
    db.query("SELECT id, name FROM brands ORDER BY name"),
    db.query("SELECT id, brand_id AS \"brandId\", sensor_number AS \"sensorNumber\", quantity, box, cars FROM sensors"),
    db.query("SELECT id, sensor_id AS \"sensorId\", change, type, ts FROM movements"),
    db.query("SELECT id, brand_name AS \"brandName\", sensor_number AS \"sensorNumber\", qty, notes FROM to_buy"),
    db.query("SELECT id, name FROM equivalent_groups"),
    db.query("SELECT id, group_id AS \"groupId\", sensor_id AS \"sensorId\", brand_name AS \"brandName\", part_number AS \"partNumber\", note FROM equivalent_members"),
    db.query("SELECT low_stock_threshold AS threshold, fast_mover_window_days AS \"windowDays\", active_brand_id AS \"activeBrand\" FROM settings WHERE id = 1"),
    db.query("SELECT version FROM sync_meta WHERE id = 1"),
  ]);

  const membersByGroup = {};
  for (const m of members.rows) {
    (membersByGroup[m.groupId] = membersByGroup[m.groupId] || []).push({
      id: m.id, sensorId: m.sensorId, brandName: m.brandName, partNumber: m.partNumber, note: m.note,
    });
  }
  const equivalents = groups.rows.map(g => ({
    id: g.id, name: g.name, members: membersByGroup[g.id] || [],
  }));

  const settings = settingsRow.rows[0] || { threshold: 2, windowDays: 30, activeBrand: null };

  return {
    brands: brands.rows,
    sensors: sensors.rows,
    movements: movements.rows,
    toBuy: toBuy.rows,
    equivalents,
    settings: { threshold: settings.threshold, windowDays: settings.windowDays },
    activeBrand: settings.activeBrand,
    version: parseInt(versionRow.rows[0].version, 10),
  };
}

// ---------- routes ----------

// Lightweight — the frontend polls this often to check if anything changed.
app.get("/api/version", async (req, res) => {
  try {
    const r = await pool.query("SELECT version FROM sync_meta WHERE id = 1");
    res.json({ version: parseInt(r.rows[0].version, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read version" });
  }
});

app.get("/api/state", async (req, res) => {
  try {
    const state = await loadFullState(pool);
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load state" });
  }
});

// Full replace-all write. The frontend keeps one in-memory `state` object
// (same pattern as before) and PUTs the whole thing on every change — for a
// single-shop inventory this is simpler and safer than fine-grained patch
// endpoints, at the cost of a bit more bandwidth per save.
app.put("/api/state", async (req, res) => {
  const s = req.body || {};
  const brands = Array.isArray(s.brands) ? s.brands : [];
  const sensors = Array.isArray(s.sensors) ? s.sensors : [];
  const movements = Array.isArray(s.movements) ? s.movements : [];
  const toBuy = Array.isArray(s.toBuy) ? s.toBuy : [];
  const equivalents = Array.isArray(s.equivalents) ? s.equivalents : [];
  const threshold = Number.isFinite(s.settings?.threshold) ? s.settings.threshold : 2;
  const windowDays = Number.isFinite(s.settings?.windowDays) ? s.settings.windowDays : 30;
  const activeBrand = s.activeBrand || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Replace-all: clear dependent tables (children first) then bulk insert.
    await client.query("DELETE FROM equivalent_members");
    await client.query("DELETE FROM equivalent_groups");
    await client.query("DELETE FROM movements");
    await client.query("DELETE FROM sensors");
    await client.query("DELETE FROM brands");
    await client.query("DELETE FROM to_buy");

    for (const b of brands) {
      await client.query("INSERT INTO brands (id, name) VALUES ($1, $2)", [b.id, b.name]);
    }
    for (const sn of sensors) {
      await client.query(
        "INSERT INTO sensors (id, brand_id, sensor_number, quantity, box, cars) VALUES ($1,$2,$3,$4,$5,$6)",
        [sn.id, sn.brandId, sn.sensorNumber, sn.quantity || 0, sn.box || "", JSON.stringify(sn.cars || [])]
      );
    }
    for (const m of movements) {
      await client.query(
        "INSERT INTO movements (id, sensor_id, change, type, ts) VALUES ($1,$2,$3,$4,$5)",
        [m.id, m.sensorId, m.change, m.type, m.ts]
      );
    }
    for (const tb of toBuy) {
      await client.query(
        "INSERT INTO to_buy (id, brand_name, sensor_number, qty, notes) VALUES ($1,$2,$3,$4,$5)",
        [tb.id, tb.brandName, tb.sensorNumber, tb.qty || 1, tb.notes || ""]
      );
    }
    for (const g of equivalents) {
      await client.query("INSERT INTO equivalent_groups (id, name) VALUES ($1,$2)", [g.id, g.name || ""]);
      for (const mem of g.members || []) {
        await client.query(
          "INSERT INTO equivalent_members (id, group_id, sensor_id, brand_name, part_number, note) VALUES ($1,$2,$3,$4,$5,$6)",
          [mem.id, g.id, mem.sensorId || null, mem.brandName, mem.partNumber, mem.note || ""]
        );
      }
    }

    await client.query(
      "UPDATE settings SET low_stock_threshold=$1, fast_mover_window_days=$2, active_brand_id=$3, updated_at=now() WHERE id=1",
      [threshold, windowDays, activeBrand]
    );

    const version = await bumpVersion(client);
    await client.query("COMMIT");
    res.json({ ok: true, version: parseInt(version, 10) });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to save state" });
  } finally {
    client.release();
  }
});

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`O2 Sensor Inventory server listening on port ${PORT}`));
  })
  .catch(err => {
    console.error("Failed to set up schema:", err);
    process.exit(1);
  });
