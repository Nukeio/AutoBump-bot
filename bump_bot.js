const {
  Client, GatewayIntentBits, Events, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");

// ── Environment variables ─────────────────────────────────────────────────────
const TOKEN               = process.env.BOT_TOKEN;
const BUMP_CHANNEL_ID     = process.env.BUMP_CHANNEL_ID;
const OWNER_ID            = process.env.OWNER_ID;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID; // Announcements channel
const REVIEW_CHANNEL_ID   = process.env.REVIEW_CHANNEL_ID;   // #application-review channel
const BUMP_COOLDOWN_MS   = 2 * 60 * 60 * 1000; // 2 hours
const REMINDER_INTERVAL_MS = 15 * 60 * 1000;    // Poll every 15 min after cooldown

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

let reminderInterval;
let lastBotMessage  = null;
let stickyTimeout   = null;
let lastBumpTime    = null;

// ── Crash protection ──────────────────────────────────────────────────────────
process.on("unhandledRejection", (e) => console.error("⚠️ Unhandled rejection:", e?.message ?? e));
process.on("uncaughtException",  (e) => console.error("⚠️ Uncaught exception:",  e?.message ?? e));

// ── Auto-reconnect ────────────────────────────────────────────────────────────
client.on(Events.ShardDisconnect,   (ev, id) => console.warn(`⚠️ Shard ${id} disconnected.`));
client.on(Events.ShardReconnecting, (id)      => console.log(`🔄 Shard ${id} reconnecting...`));
client.on(Events.ShardResume,       (id, n)   => console.log(`✅ Shard ${id} resumed (${n} events).`));

// ═════════════════════════════════════════════════════════════════════════════
//  BUMP SYSTEM
// ═════════════════════════════════════════════════════════════════════════════

// Deletes the previous bot message if it exists
async function clearLastMessage() {
  if (lastBotMessage) {
    try { await lastBotMessage.delete(); } catch (_) {}
    lastBotMessage = null;
  }
}

// Ready to bump — cooldown has expired
async function sendBumpReminder() {
  try {
    const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
    if (!channel) return console.error("❌ Bump channel not found!");

    await clearLastMessage();

    const embed = new EmbedBuilder()
      .setTitle("🚀 Bump the Server!")
      .setDescription(
        "**The cooldown is over — time to bump!**\n\n" +
        "📌 **How to bump:**\n" +
        "> Type `/bump` in this channel\n" +
        "> Select **DISBOARD** from the bot list\n" +
        "> Hit enter and you're done!\n\n" +
        "🎯 Bumping helps new members discover our server.\n" +
        "⏰ **Every bump counts — thank you!**"
      )
      .setColor(0x5865f2)
      .setThumbnail("https://disboard.org/images/bot-command-image-disboard.png")
      .setFooter({ text: "Cooldown is over — bump now!" })
      .setTimestamp();

    lastBotMessage = await channel.send({ embeds: [embed] });
    console.log(`✅ [${new Date().toLocaleString()}] Bump reminder sent!`);
  } catch (e) {
    console.error("❌ Failed to send bump reminder:", e.message);
  }
}

// Just bumped — show live countdown using Discord's <t:timestamp:R> format
async function sendCooldownMessage(channel) {
  await clearLastMessage();

  lastBumpTime = Date.now();
  const readyAt = Math.floor((lastBumpTime + BUMP_COOLDOWN_MS) / 1000); // Unix seconds

  const embed = new EmbedBuilder()
    .setTitle("✅ Server Bumped!")
    .setDescription(
      "**Thanks for bumping! 🎉**\n\n" +
      `⏳ **Next bump available:** <t:${readyAt}:R>\n` +
      `🕐 **Ready at:** <t:${readyAt}:t>\n\n` +
      "I'll ping when the cooldown is over. Keep an eye out! 👀"
    )
    .setColor(0x57f287)
    .setFooter({ text: "Cooldown: 2 hours" })
    .setTimestamp();

  lastBotMessage = await channel.send({ embeds: [embed] });
  console.log(`✅ Cooldown message sent. Next bump <t:${readyAt}:R>`);
}

function isBumpSuccess(message) {
  if (message.author.id !== "302050872383242240") return false;
  if (!message.embeds.length) return false;
  const desc  = message.embeds[0]?.description?.toLowerCase() ?? "";
  const title = message.embeds[0]?.title?.toLowerCase() ?? "";
  return desc.includes("bump done") || desc.includes("bumped") ||
         title.includes("bump done") || title.includes("bumped");
}

function handleBumpSuccess(channel) {
  console.log("✅ Bump detected! Starting 2 hour cooldown.");
  clearInterval(reminderInterval);

  sendCooldownMessage(channel);

  // After 2 hours send the reminder, then poll every 15 min if missed
  setTimeout(() => {
    sendBumpReminder();
    reminderInterval = setInterval(sendBumpReminder, REMINDER_INTERVAL_MS);
  }, BUMP_COOLDOWN_MS);
}

// ═════════════════════════════════════════════════════════════════════════════
//  MOD APPLICATION SYSTEM
// ═════════════════════════════════════════════════════════════════════════════

// Post the announcement embed with Apply button
async function postModApplication() {
  try {
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
    if (!channel) return console.error("❌ Announcement channel not found!");

    const embed = new EmbedBuilder()
      .setTitle("🛡️ Moderator Applications — Now Open!")
      .setDescription(
        "We're looking for passionate, dedicated members to join the **Magic Tiles 3 Community** moderation team!\n\n" +
        "If you love keeping things fun, fair, and welcoming — this is your chance. 🎮\n\u200b"
      )
      .addFields(
        {
          name: "📋 Requirements",
          value: [
            "• **Consistently active** in the server",
            "• **No recent warnings** or rule violations",
            "• Must be **13 years or older**",
            "• Can communicate clearly in **English**",
          ].join("\n"),
        },
        {
          name: "✅ What We're Looking For",
          value: [
            "• Calm, fair and unbiased attitude",
            "• Availability of at least **a few hours per week**",
            "• Experience in moderation is a **plus, not required**",
            "• Passion for Magic Tiles 3 and the community",
            "• Ability to handle conflict maturely",
          ].join("\n"),
        },
        {
          name: "🎯 Your Responsibilities",
          value: [
            "• Enforce server rules and keep chats clean",
            "• Welcome new members and answer questions",
            "• Assist in events and community activities",
            "• Report issues to senior staff",
            "• Help shape the server culture",
          ].join("\n"),
        },
        {
          name: "⚠️ Before You Apply",
          value: [
            "• Providing false info will result in a **permanent ban**",
            "• Applications are reviewed **privately** by the staff team",
            "• You will be **DMed** with the outcome",
          ].join("\n"),
        }
      )
      .setColor(0xfee75c)
      .setFooter({ text: "Magic Tiles 3 Community • Staff Team" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_mod_application")
        .setLabel("📝 Apply for Moderator")
        .setStyle(ButtonStyle.Primary),
    );

    await channel.send({ content: "@everyone", embeds: [embed], components: [row] });
    console.log("✅ Mod application post sent to announcements!");
  } catch (e) {
    console.error("❌ Failed to post mod application:", e.message);
  }
}

// Open the modal when someone clicks Apply
async function handleModApplicationButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("mod_application_form")
    .setTitle("Moderator Application");

  const age = new TextInputBuilder()
    .setCustomId("app_age")
    .setLabel("How old are you?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 17")
    .setRequired(true);

  const timezone = new TextInputBuilder()
    .setCustomId("app_timezone")
    .setLabel("Timezone & weekly availability?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. GMT+8, available evenings and weekends")
    .setRequired(true);

  const experience = new TextInputBuilder()
    .setCustomId("app_experience")
    .setLabel("Do you have moderation experience?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Describe any past mod/admin roles, or write 'None'")
    .setRequired(true);

  const whyYou = new TextInputBuilder()
    .setCustomId("app_why")
    .setLabel("Why do you want to be a moderator?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Tell us why you'd be a great fit...")
    .setRequired(true);

  const scenario = new TextInputBuilder()
    .setCustomId("app_scenario")
    .setLabel("How would you handle a heated argument?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Describe how you'd de-escalate a conflict between members...")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(age),
    new ActionRowBuilder().addComponents(timezone),
    new ActionRowBuilder().addComponents(experience),
    new ActionRowBuilder().addComponents(whyYou),
    new ActionRowBuilder().addComponents(scenario),
  );

  await interaction.showModal(modal);
}

// Receive modal submission and forward to review channel
async function handleModApplicationSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const age        = interaction.fields.getTextInputValue("app_age");
  const timezone   = interaction.fields.getTextInputValue("app_timezone");
  const experience = interaction.fields.getTextInputValue("app_experience");
  const whyYou     = interaction.fields.getTextInputValue("app_why");
  const scenario   = interaction.fields.getTextInputValue("app_scenario");
  const applicant  = interaction.user;

  try {
    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID);
    if (!reviewChannel) throw new Error("Review channel not found");

    const reviewEmbed = new EmbedBuilder()
      .setTitle("📥 New Moderator Application")
      .setThumbnail(applicant.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: "👤 Applicant",               value: `${applicant} (${applicant.tag})\nID: \`${applicant.id}\``, inline: false },
        { name: "🎂 Age",                     value: age,        inline: true  },
        { name: "🕐 Timezone & Availability", value: timezone,   inline: true  },
        { name: "🛠️ Moderation Experience",   value: experience, inline: false },
        { name: "💬 Why They Want to Mod",    value: whyYou,     inline: false },
        { name: "🔥 Conflict Scenario",       value: scenario,   inline: false },
      )
      .setColor(0x5865f2)
      .setFooter({ text: "React with Accept or Deny below" })
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`app_accept_${applicant.id}`)
        .setLabel("✅ Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`app_deny_${applicant.id}`)
        .setLabel("❌ Deny")
        .setStyle(ButtonStyle.Danger),
    );

    await reviewChannel.send({ embeds: [reviewEmbed], components: [actionRow] });

    await interaction.editReply({
      content: "✅ **Application submitted successfully!**\nOur staff team will review it and DM you with the result. Good luck! 🍀",
    });

    console.log(`📥 New mod application received from ${applicant.tag}`);
  } catch (e) {
    console.error("❌ Failed to forward application:", e.message);
    await interaction.editReply({
      content: "❌ Something went wrong. Please try again or contact an admin.",
    });
  }
}

// Staff clicks Accept or Deny → DM the applicant
async function handleAppDecision(interaction, accepted) {
  const applicantId = interaction.customId.split("_").pop();

  try {
    const applicant = await client.users.fetch(applicantId);
    const decider   = interaction.user;

    const resultEmbed = new EmbedBuilder()
      .setTitle(accepted ? "🎉 Application Accepted!" : "❌ Application Denied")
      .setDescription(
        accepted
          ? `Congratulations **${applicant.username}**! 🎊\n\nYour moderator application for **Magic Tiles 3 Community** has been **accepted**.\nA staff member will reach out shortly to get you onboarded. Welcome to the team!`
          : `Hi **${applicant.username}**, thank you for applying to **Magic Tiles 3 Community**.\n\nUnfortunately your application was **not accepted** at this time. Don't be discouraged — stay active and feel free to apply again in the future!`
      )
      .setColor(accepted ? 0x57f287 : 0xed4245)
      .setFooter({ text: "Magic Tiles 3 Community • Staff Team" })
      .setTimestamp();

    await applicant.send({ embeds: [resultEmbed] });

    // Update the review message to show who made the decision
    const updatedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("decided")
        .setLabel(`${accepted ? "✅ Accepted" : "❌ Denied"} by ${decider.tag}`)
        .setStyle(accepted ? ButtonStyle.Success : ButtonStyle.Danger)
        .setDisabled(true),
    );

    await interaction.update({ components: [updatedRow] });
    console.log(`${accepted ? "✅" : "❌"} Application for ${applicant.tag} ${accepted ? "accepted" : "denied"} by ${decider.tag}`);
  } catch (e) {
    console.error("❌ Failed to process decision:", e.message);
    await interaction.reply({ content: "❌ Could not DM the applicant. They may have DMs disabled.", ephemeral: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MESSAGE CREATE — bump channel logic
// ═════════════════════════════════════════════════════════════════════════════

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Owner commands — work in any channel
  if (message.author.id === OWNER_ID) {
    // !remind — manually trigger bump reminder
    if (message.content.trim() === "!remind") {
      try { await message.delete(); } catch (_) {}
      await sendBumpReminder();
      return;
    }

    // !modapp — post the moderator application to announcements
    if (message.content.trim() === "!modapp") {
      try { await message.delete(); } catch (_) {}
      await postModApplication();
      return;
    }
  }

  // Non-owner tries !remind
  if (message.content.trim() === "!remind") {
    const reply = await message.reply("❌ You don't have permission to do that.");
    setTimeout(() => reply.delete().catch(() => {}), 5000);
    return;
  }

  // Bump channel only from here
  if (message.channel.id !== BUMP_CHANNEL_ID) return;

  if (isBumpSuccess(message)) {
    try { await message.delete(); } catch (_) {}
    handleBumpSuccess(message.channel);
    return;
  }

  // Sticky — repost reminder to bottom when someone chats
  if (lastBotMessage) {
    clearTimeout(stickyTimeout);
    stickyTimeout = setTimeout(async () => {
      try {
        await lastBotMessage.delete();
        lastBotMessage = null;
        await sendBumpReminder();
      } catch (_) {}
    }, 3000);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  INTERACTION CREATE — buttons & modals
// ═════════════════════════════════════════════════════════════════════════════

client.on(Events.InteractionCreate, async (interaction) => {

  // ── Disboard bump detection ───────────────────────────────────────────────
  if (!interaction.isCommand?.() && interaction.applicationId === "302050872383242240") {
    console.log("📨 Disboard interaction:", JSON.stringify(interaction?.message?.embeds?.[0] ?? {}));
    if (interaction.message && isBumpSuccess(interaction.message)) {
      try { await interaction.message.delete(); } catch (_) {}
      handleBumpSuccess(interaction.channel);
    }
    return;
  }

  // ── Mod application button ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "open_mod_application") {
    await handleModApplicationButton(interaction);
    return;
  }

  // ── Mod application modal submit ──────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "mod_application_form") {
    await handleModApplicationSubmit(interaction);
    return;
  }

  // ── Staff accept / deny buttons ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("app_accept_")) {
    await handleAppDecision(interaction, true);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("app_deny_")) {
    await handleAppDecision(interaction, false);
    return;
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  READY
// ═════════════════════════════════════════════════════════════════════════════

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`⏰ Bump reminders every 15 minutes`);
  console.log(`📋 Mod app system ready — type !modapp to post`);

  sendBumpReminder();
  reminderInterval = setInterval(sendBumpReminder, REMINDER_INTERVAL_MS);
});

client.login(TOKEN);
