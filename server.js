const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");
const cors = require("cors");
const OpenAI = require("openai");
const { google } = require("googleapis");
const chrono = require("chrono-node");
const nodemailer = require("nodemailer");

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

if (process.env.REFRESH_TOKEN) {
  oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
} else {
  console.warn("⚠️ No REFRESH_TOKEN found in environment.");
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.NOTIFY_EMAIL_FROM,
    pass: process.env.NOTIFY_EMAIL_PASS,
  },
});

function sendNotificationEmail({ name, dateTime, reason, link }) {
  const mailOptions = {
    from: process.env.NOTIFY_EMAIL_FROM,
    to: process.env.NOTIFY_EMAIL_TO,
    subject: `📅 New Appointment: ${name}`,
    html: `
      <h2>New Appointment Scheduled</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Date/Time:</strong> ${dateTime}</p>
      <p><a href="${link}" target="_blank">📅 View in Google Calendar</a></p>
    `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Email failed:", error);
    } else {
      console.log("📧 Email sent:", info.response);
    }
  });
}

app.get("/auth/google", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });
  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing authorization code.");

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    console.log("📥 Tokens received:", tokens);
    res.send("✅ Google auth successful. Add the refresh_token to Render.");
  } catch (error) {
    console.error(
      "❌ Google auth error:",
      error.response?.data || error.message
    );
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
  content: `
You are NazborgAI — a smart, custom-built AI chatbot created by Eddie Nazario.
You live inside Eddie's personal web portfolio (nazariodev.com) and are powered by a backend server built with Node.js, Express, and OpenAI's API. You store conversations in a local SQLite database to remember past interactions and provide context.
Your job is to answer questions about Eddie using only the facts below. Be helpful, friendly, and professional.
✅ If asked in Spanish, respond in Spanish.
✅ If asked in English, respond in English.
⛔ Do NOT make anything up. If unsure, say: "I don’t have that information."
✨ If someone asks about you, explain you were created by Eddie Nazario as part of his React developer portfolio.
If the user says anything that sounds like scheduling, booking, making an appointment, meeting, or follow-up, extract their name, intended date/time, and the reason. Then return a JSON block like this:
{"action": "schedule", "name": "John", "dateTime": "next Friday at 2pm", "reason": "Learn React"}
✅ Be flexible with casual phrases like "Can I meet tomorrow?" or "Set something up for me."
⛔ Do NOT generate a JSON unless all 3 parts (name, date/time, reason) are clear — otherwise, ask the user for what’s missing.`.trim(),
};

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
      console.log("🤔 AI raw reply:", reply);

      saveMessage("user", userMessage);
      saveMessage("assistant", reply);

      const match = reply.match(/\{\s*"action"\s*:\s*"schedule".*\}/s);
      if (match) {
        try {
          const json = JSON.parse(match[0]);
          const parsedDate = chrono.parseDate(json.dateTime);
          if (json.name && parsedDate && json.reason) {
            const calendar = google.calendar({
              version: "v3",
              auth: oAuth2Client,
            });
            const event = {
              summary: `Appointment with ${json.name}`,
              description: json.reason,
              start: {
                dateTime: parsedDate.toISOString(),
                timeZone: "America/New_York",
              },
              end: {
                dateTime: new Date(
                  parsedDate.getTime() + 30 * 60000
                ).toISOString(),
                timeZone: "America/New_York",
              },
            };
            const result = await calendar.events.insert({
              calendarId: "primary",
              resource: event,
            });

            sendNotificationEmail({
              name: json.name,
              dateTime: json.dateTime,
              reason: json.reason,
              link: result.data.htmlLink,
            });

            return res.json({
              reply: `${reply}\n\n✅ [View your event](${result.data.htmlLink})`,
            });
          }
        } catch (err) {
          console.error("Failed to parse or schedule:", err);
        }
      }

      const fallbackDate = chrono.parseDate(userMessage);
      if (fallbackDate) {
        const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
        const event = {
          summary: `Appointment with user`,
          description: userMessage,
          start: {
            dateTime: fallbackDate.toISOString(),
            timeZone: "America/New_York",
          },
          end: {
            dateTime: new Date(
              fallbackDate.getTime() + 30 * 60000
            ).toISOString(),
            timeZone: "America/New_York",
          },
        };
        const result = await calendar.events.insert({
          calendarId: "primary",
          resource: event,
        });

        sendNotificationEmail({
          name: "user",
          dateTime: userMessage,
          reason: userMessage,
          link: result.data.htmlLink,
        });

        return res.json({
          reply: `${reply}\n\n✅ [Click here to view appointment](${result.data.htmlLink})`,
        });
      }

      res.json({ reply });
    } catch (err) {
      console.error("OpenAI error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  });
});

app.post("/schedule", async (req, res) => {
  const { name, dateTime, reason } = req.body;
  if (!name || !dateTime || !reason) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const parsedDate = chrono.parseDate(dateTime);
  if (!parsedDate) {
    return res.status(400).json({ error: "Invalid date/time format." });
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
    const event = {
      summary: `Appointment with ${name}`,
      description: reason,
      start: {
        dateTime: parsedDate.toISOString(),
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

    sendNotificationEmail({
      name,
      dateTime,
      reason,
      link: response.data.htmlLink,
    });

    res.json({ success: true, eventLink: response.data.htmlLink });
  } catch (err) {
    console.error("Google Calendar error:", err);
    res
      .status(500)
      .json({ error: "Failed to schedule appointment", details: err.message });
  }
});

app.listen(3001, () => {
  console.log("✅ NazborgAI backend running on http://localhost:3001");
});
