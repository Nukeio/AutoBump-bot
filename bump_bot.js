const { Client, GatewayIntentBits, Events, EmbedBuilder } = require("discord.js");

const TOKEN = process.env.BOT_TOKEN;
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID;
const REMINDER_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let reminderInterval;
let lastBotMessage = null;
let stickyTimeout = null; // Debounce sticky repost so it doesn't spam

// ── Auto-reconnect on disconnect ──────────────────────────────────────────────
client.on(Events.ShardDisconnect, (event, shardId) => {
  console.warn(`⚠️ Shard ${shardId} disconnected (code ${event.code}). Reconnecting...`);
});

client.on(Events.ShardReconnecting, (shardId) => {
  console.log(`🔄 Shard ${shardId} reconnecting...`);
});

client.on(Events.ShardResume, (shardId, replayedEvents) => {
  console.log(`✅ Shard ${shardId} resumed. Replayed ${replayedEvents} events.`);
});

// Catch any unhandled errors so the process never crashes
process.on("unhandledRejection", (error) => {
  console.error("⚠️ Unhandled promise rejection:", error?.message ?? error);
});

process.on("uncaughtException", (error) => {
  console.error("⚠️ Uncaught exception:", error?.message ?? error);
});


async function sendBumpReminder() {
  try {
    const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
    if (!channel) {
      console.error("❌ Bump channel not found!");
      return;
    }

    // Delete previous bot reminder message if it exists
    if (lastBotMessage) {
      try {
        await lastBotMessage.delete();
      } catch (_) {
        // Message may have already been deleted, ignore
      }
      lastBotMessage = null;
    }

    const embed = new EmbedBuilder()
      .setTitle("🚀 Bump the Server!")
      .setDescription(
        "**Help us grow by bumping the server on Disboard!**\n\n" +
        "📌 **How to bump:**\n" +
        "> Type `/bump` in this channel\n" +
        "> Select **DISBOARD** from the bot list\n" +
        "> Hit enter and you're done!\n\n" +
        "🎯 Bumping helps new members discover our server.\n" +
        "⏰ **Every bump counts — thank you!**"
      )
      .setColor(0x5865f2) // Discord blurple
      .setThumbnail("https://disboard.org/images/bot-command-image-disboard.png")
      .setFooter({ text: "Reminder sent every 15 minutes until bumped" })
      .setTimestamp();

    const sent = await channel.send({ embeds: [embed] });
    lastBotMessage = sent;

    const timestamp = new Date().toLocaleString();
    console.log(`✅ [${timestamp}] Bump reminder sent!`);
  } catch (error) {
    console.error("❌ Failed to send reminder:", error.message);
  }
}

async function sendBumpSuccess(channel) {
  // Delete the reminder message when someone bumps
  if (lastBotMessage) {
    try {
      await lastBotMessage.delete();
    } catch (_) {}
    lastBotMessage = null;
  }

  const embed = new EmbedBuilder()
    .setTitle("✅ Server Bumped!")
    .setDescription(
      "**Thanks for bumping the server!** 🎉\n\n" +
      "The next reminder will be sent in **2 hours**.\n" +
      "Keep up the great work helping the server grow! 💪"
    )
    .setColor(0x57f287) // Green
    .setFooter({ text: "Next reminder in 2 hours" })
    .setTimestamp();

  const sent = await channel.send({ embeds: [embed] });
  lastBotMessage = sent;

  // Auto delete success message after 10 minutes
  setTimeout(async () => {
    try {
      await sent.delete();
      if (lastBotMessage?.id === sent.id) lastBotMessage = null;
    } catch (_) {}
  }, 10 * 60 * 1000);
}

function isBumpSuccess(message) {
  if (message.author.id !== "302050872383242240") return false;
  if (message.embeds.length === 0) return false;

  const desc = message.embeds[0]?.description?.toLowerCase() ?? "";
  const title = message.embeds[0]?.title?.toLowerCase() ?? "";

  // Covers all known Disboard bump success message variants
  return (
    desc.includes("bump done") ||
    desc.includes("bumped") ||
    title.includes("bump done") ||
    title.includes("bumped")
  );
}

function handleBumpSuccess(channel) {
  console.log("✅ Bump detected! Pausing reminders for 2 hours.");
  clearInterval(reminderInterval);

  sendBumpSuccess(channel);

  // Resume reminders after 2 hours
  setTimeout(() => {
    sendBumpReminder();
    reminderInterval = setInterval(sendBumpReminder, REMINDER_INTERVAL_MS);
  }, 2 * 60 * 60 * 1000);
}

// Catch regular messages from Disboard (older behavior)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== BUMP_CHANNEL_ID) return;

  // Manual trigger: only you (OWNER_ID) can run !remind
  if (message.content.trim() === "!remind") {
    if (message.author.id !== OWNER_ID) {
      const reply = await message.reply("❌ You don't have permission to do that.");
      setTimeout(() => reply.delete().catch(() => {}), 5000);
      return;
    }
    try { await message.delete(); } catch (_) {}
    await sendBumpReminder();
    return;
  }

  if (isBumpSuccess(message)) {
    try { await message.delete(); } catch (_) {}
    handleBumpSuccess(message.channel);
    return;
  }

  // ── Sticky logic ─────────────────────────────────────────────────────────
  // When anyone sends a message in the bump channel, repost the reminder
  // to the bottom after a short delay (debounced so rapid messages = 1 repost)
  if (lastBotMessage) {
    clearTimeout(stickyTimeout);
    stickyTimeout = setTimeout(async () => {
      try {
        // Delete old reminder and repost it at the bottom
        await lastBotMessage.delete();
        lastBotMessage = null;
        await sendBumpReminder();
      } catch (_) {}
    }, 3000); // Wait 3 seconds after last message before reposting
  }
});

// Catch Disboard's interaction/slash command response (new behavior)
client.on(Events.InteractionCreate, async (interaction) => {
  if (
    !interaction.isCommand?.() &&
    interaction.applicationId === "302050872383242240"
  ) {
    // Log to help debug if embed content differs
    console.log("📨 Disboard interaction received:", JSON.stringify(interaction?.message?.embeds?.[0] ?? {}));

    if (interaction.message && isBumpSuccess(interaction.message)) {
      try { await interaction.message.delete(); } catch (_) {}
      handleBumpSuccess(interaction.channel);
    }
  }
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`⏰ Sending fancy bump reminders every 15 minutes.`);

  sendBumpReminder();
  reminderInterval = setInterval(sendBumpReminder, REMINDER_INTERVAL_MS);
});

client.login(TOKEN);
