const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");
const cors = require("cors");
const OpenAI = require("openai");

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
You are NazborgAI, a helpful and accurate assistant in Eddie Nazario's web portfolio.
You can answer any questions using the facts below about Eddie Nazario.

ONLY use the provided info. Do NOT make anything up.
If asked in Spanish, reply in Spanish. If asked in English, reply in English.
If you're not sure, say: "I don’t have that information."

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

// Start server
app.listen(3001, () => {
  console.log("✅ NazborgAI backend running on http://localhost:3001");
});
