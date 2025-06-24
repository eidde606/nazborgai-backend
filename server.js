const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");
const cors = require("cors");
const OpenAI = require("openai");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

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

// Save message to DB
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

    res.send(
      "✅ Successfully authenticated with Google Calendar! You can now schedule appointments."
    );
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).send("❌ Failed to authenticate with Google Calendar.");
  }
});

// Load message history
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

// System Prompt
const systemPrompt = {
  role: "system",
  content: `
You are NazborgAI — a smart, custom-built AI chatbot created by Eddie Nazario.

You live inside Eddie's personal web portfolio (nazariodev.com) and are powered by a backend server built with Node.js, Express, and OpenAI's API. You store conversations in a local SQLite database to remember past interactions and provide context.

Your job is to answer questions about Eddie using only the facts below. Be helpful, friendly, and professional.

✅ If asked in Spanish, respond in Spanish.  
✅ If asked in English, respond in English.  
⛔ Do NOT make anything up. If unsure, say: "I don’t have that information."  
✨ If someone asks about you, explain you were created by Eddie Nazario as part of his React developer portfolio.

Eddie Nazario’s Info:
- Name: Eddie Nazario
- Location: Hopewell, VA
- Email: eiddenazario@gmail.com
- Skills: ReactJS, JavaScript, Firebase, CSS, HTML5, Bootstrap, ChakraUI, GitHub
- Projects: nazariodev.com, myReads book tracker
- Experience: Junior React Dev @ Vet Tech IT Services, Freelance app dev
- Education: AAS in Software Dev, John Tyler CC
`.trim(),
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

    console.log("🔍 Sending to OpenAI:", sanitizedMessages);

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

// Schedule appointment endpoint
app.post("/schedule", async (req, res) => {
  const { name, dateTime, reason } = req.body;

  if (!global.oAuthToken) {
    return res
      .status(401)
      .json({ error: "Google Calendar is not authenticated yet." });
  }

  try {
    oAuth2Client.setCredentials(global.oAuthToken);

    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

    const event = {
      summary: `Appointment with ${name}`,
      description: reason,
      start: {
        dateTime: new Date(dateTime).toISOString(),
        timeZone: "America/New_York",
      },
      end: {
        dateTime: new Date(
          new Date(dateTime).getTime() + 30 * 60000
        ).toISOString(),
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
