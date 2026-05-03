const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.BOT_TOKEN;
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;
const BUMP_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

async function sendBump() {
  try {
    const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
    if (!channel) {
      console.error("❌ Bump channel not found! Check your BUMP_CHANNEL_ID.");
      return;
    }

    // Send the Disboard bump command
    await channel.send("!d bump");
    const timestamp = new Date().toLocaleString();
    console.log(`✅ [${timestamp}] Bump command sent successfully!`);
  } catch (error) {
    console.error("❌ Failed to send bump:", error.message);
  }
}

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`⏰ Will bump every 2 hours in channel: ${BUMP_CHANNEL_ID}`);

  // Send first bump immediately on startup
  sendBump();

  // Then bump every 2 hours
  setInterval(sendBump, BUMP_INTERVAL_MS);
});

client.login(TOKEN);
