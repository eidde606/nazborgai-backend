const { google } = require("googleapis");
const readline = require("readline");
require("dotenv").config();

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("👉 Visit this URL to authorize:");
console.log(authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\nPaste the code here: ", async (code) => {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    console.log("\n✅ Access token:", tokens.access_token);
    console.log("🔁 Refresh token:", tokens.refresh_token);
    console.log(
      "🔐 Save this refresh token in your .env file as GOOGLE_REFRESH_TOKEN"
    );

    rl.close();
  } catch (err) {
    console.error("❌ Error retrieving access token", err);
    rl.close();
  }
});
