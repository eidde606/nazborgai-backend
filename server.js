const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");
const cors = require("cors");
const OpenAI = require("openai");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const chrono = require("chrono-node"); // ✅ NEW

// Load .env
dotenv.config();

// Init OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Init Express
const app = express();
app.use(cors());
app.use(bodyParser.json());

// SQLite setup
const db = new sqlite3.Database("./nazborg.db");
db.run(
  "CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT)"
);

function saveMessage(role, content) {
  db.run("INSERT INTO conversations (role, content) VALUES (?, ?)", [
    role,
    content,
  ]);
}

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

app.get("/auth/google", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });
  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    global.oAuthToken = tokens;
    res.send("✅ Successfully authenticated with Google Calendar!");
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).send("❌ Failed to authenticate with Google Calendar.");
  }
});

function loadMessages(callback) {
  db.all("SELECT role, content FROM conversations", (err, rows) => {
    if (err) {
      console.error("DB read error:", err);
      callback([]);
    } else {
      callback(rows);
    }
  });
}

const systemPrompt = {
  role: "system",
  content:
    `You are NazborgAI — a smart, custom-built AI chatbot created by Eddie Nazario.
...`.trim(),
};

// Chat endpoint
app.post("/chat", async (req, res) => {
  const userMessage = req.body.prompt;

  if (!userMessage || typeof userMessage !== "string" || !userMessage.trim()) {
    return res.status(400).json({ error: "Invalid prompt" });
  }

  loadMessages(async (history) => {
    const fullMessages = [
      systemPrompt,
      ...history,
      { role: "user", content: userMessage },
    ];

    const sanitizedMessages = fullMessages.filter(
      (msg) =>
        msg?.role &&
        typeof msg.content === "string" &&
        msg.content.trim() !== ""
    );

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: sanitizedMessages,
      });

      const reply = completion.choices[0].message.content;

      if (reply?.trim()) {
        saveMessage("user", userMessage);
        saveMessage("assistant", reply);
        res.json({ reply });
      } else {
        res.json({ reply: "🤖 No response from NazborgAI." });
      }
    } catch (err) {
      console.error("OpenAI error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  });
});

// ✅ Updated Schedule Endpoint with chrono-node parsing
app.post("/schedule", async (req, res) => {
  const { name, dateTime, reason } = req.body;

  if (!global.oAuthToken) {
    return res
      .status(401)
      .json({ error: "Google Calendar is not authenticated yet." });
  }

  // ✅ Parse human-friendly datetime
  const parsedDate = chrono.parseDate(dateTime);
  if (!parsedDate) {
    return res.status(400).json({ error: "Invalid date/time format." });
  }

  try {
    oAuth2Client.setCredentials(global.oAuthToken);
    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

    const event = {
      summary: `Appointment with ${name}`,
      description: reason,
      start: {
        dateTime: parsedDate.toISOString(), // ✅ parsed to ISO
        timeZone: "America/New_York",
      },
      end: {
        dateTime: new Date(parsedDate.getTime() + 30 * 60000).toISOString(),
        timeZone: "America/New_York",
      },
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
    });

    res.json({ success: true, eventLink: response.data.htmlLink });
  } catch (err) {
    console.error("Google Calendar error:", err);
    res
      .status(500)
      .json({ error: "Failed to schedule appointment", details: err.message });
  }
});

// Start server
app.listen(3001, () => {
  console.log("✅ NazborgAI backend running on http://localhost:3001");
});
