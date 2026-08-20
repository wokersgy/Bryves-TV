require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID;
const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;
const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://bryvestv-default-rtdb.firebaseio.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function requireAdmin(req, res, next) {
  const supplied = req.headers["x-admin-password"];
  if (!ADMIN_PASSWORD || supplied !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

async function firebase(pathName, method = "GET", body) {
  const response = await fetch(
    `${FIREBASE_DATABASE_URL.replace(/\/$/, "")}/${pathName}.json`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  );

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    throw new Error(`Firebase ${method} failed (${response.status})`);
  }
  return data;
}

function muxAuth() {
  if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
    throw new Error("MUX_TOKEN_ID/MUX_TOKEN_SECRET are missing in Render.");
  }
  return Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString("base64");
}

async function muxRequest(endpoint, options = {}) {
  const response = await fetch(`https://api.mux.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Basic ${muxAuth()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!response.ok) {
    const message =
      data?.error?.messages?.join(", ") ||
      data?.error?.message ||
      data?.message ||
      text ||
      `Mux error ${response.status}`;
    throw new Error(message);
  }
  return data;
}

app.get("/api/public/status", async (_req, res) => {
  try {
    const config = (await firebase("config")) || {};
    res.json({
      success: true,
      live: config.live === true,
      status: config.status || "idle",
      playbackId: config.playbackId || null,
      title: config.title || "Bryves TV",
      description: config.description || "Welcome to Bryves TV."
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/channel", requireAdmin, async (_req, res) => {
  try {
    const config = (await firebase("config")) || {};
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch("/api/channel", requireAdmin, async (req, res) => {
  try {
    const title = String(req.body?.title || "Bryves TV").slice(0, 200);
    const description = String(req.body?.description || "").slice(0, 2000);
    await firebase("config", "PATCH", { title, description, updatedAt: Date.now() });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/live-stream/create", requireAdmin, async (req, res) => {
  try {
    const title = String(req.body?.title || "Bryves TV Live").slice(0, 512);
    const description = String(req.body?.description || "").slice(0, 2000);

    const result = await muxRequest("/video/v1/live-streams", {
      method: "POST",
      body: JSON.stringify({
        playback_policies: ["public"],
        latency_mode: "low",
        reconnect_window: 60,
        new_asset_settings: { playback_policies: ["public"] },
        meta: { title }
      })
    });

    const stream = result.data;
    const playbackId =
      stream.playback_ids?.find(x => x.policy === "public")?.id ||
      stream.playback_ids?.[0]?.id;

    if (!playbackId || !stream.stream_key) {
      throw new Error("Mux did not return Playback ID and Stream Key.");
    }

    const saved = {
      title,
      description,
      liveStreamId: stream.id,
      playbackId,
      streamKey: stream.stream_key,
      playbackUrl: `https://stream.mux.com/${playbackId}.m3u8`,
      rtmpsUrl: "rtmps://global-live.mux.com:443/app",
      status: stream.status || "idle",
      live: false,
      createdAt: Date.now()
    };

    await firebase("config", "PUT", saved);

    res.json({
      success: true,
      data: {
        id: stream.id,
        playbackId,
        streamKey: stream.stream_key,
        status: stream.status || "idle",
        playbackUrl: saved.playbackUrl,
        rtmpsUrl: saved.rtmpsUrl
      }
    });
  } catch (e) {
    console.error("create stream:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/live-stream/status", requireAdmin, async (_req, res) => {
  try {
    const config = (await firebase("config")) || {};
    if (!config.liveStreamId) {
      return res.status(404).json({ success: false, error: "No live stream created yet." });
    }

    const result = await muxRequest(
      `/video/v1/live-streams/${encodeURIComponent(config.liveStreamId)}`
    );
    const stream = result.data;
    const live = stream.status === "active";

    await firebase("config", "PATCH", {
      status: stream.status,
      live,
      checkedAt: Date.now()
    });

    res.json({
      success: true,
      live,
      status: stream.status,
      liveStreamId: stream.id,
      playbackId: config.playbackId,
      streamKey: config.streamKey
    });
  } catch (e) {
    console.error("status:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Bryves TV listening on ${PORT}`));
