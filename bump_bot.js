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
const ENGAGE_CHANNEL_ID   = process.env.ENGAGE_CHANNEL_ID;   // #trivia-and-prompts channel
const REMINDER_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DAILY_HOUR = 18; // Auto-post time: 6 PM (server local time, 24h format)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // Needed to DM applicants
  ],
});

let reminderInterval;
let lastBotMessage = null;
let stickyTimeout  = null;

// ── Crash protection ──────────────────────────────────────────────────────────
process.on("unhandledRejection", (e) => console.error("⚠️ Unhandled rejection:", e?.message ?? e));
process.on("uncaughtException",  (e) => console.error("⚠️ Uncaught exception:",  e?.message ?? e));

// ── Auto-reconnect ────────────────────────────────────────────────────────────
client.on(Events.ShardDisconnect,   (ev, id) => console.warn(`⚠️ Shard ${id} disconnected.`));
client.on(Events.ShardReconnecting, (id)      => console.log(`🔄 Shard ${id} reconnecting...`));
client.on(Events.ShardResume,       (id, n)   => console.log(`✅ Shard ${id} resumed (${n} events).`));

// ═════════════════════════════════════════════════════════════════════════════
//  WAKE-UP COMMAND
// ═════════════════════════════════════════════════════════════════════════════

const WAKEUP_MESSAGES = [
  "👀 **Ayo, is anyone alive in here?!**",
  "💀 **This chat is deader than my sleep schedule.**",
  "🔔 **WAKE UP GANG. Let's get it going!**",
  "😴 **Y'all really just gonna let this chat die like that?**",
  "🚨 **ALERT: Chat emergency detected. Immediate vibes required.**",
  "🎯 **Attention all members: it's time to be perceived.**",
];

// ═════════════════════════════════════════════════════════════════════════════
//  TRIVIA & CHAT PROMPT SYSTEM
// ═════════════════════════════════════════════════════════════════════════════

const TRIVIA_QUESTIONS = [
  // 🎮 Gaming
  { q: "Which game franchise features a hero named 'Link'?", options: ["Zelda", "Mario", "Metroid", "Kirby"], answer: 0, category: "🎮 Gaming" },
  { q: "What is the best-selling video game of all time (as of 2024)?", options: ["Minecraft", "Tetris", "GTA V", "Wii Sports"], answer: 0, category: "🎮 Gaming" },
  { q: "In what year was the first PlayStation released in Japan?", options: ["1994", "1996", "1992", "1998"], answer: 0, category: "🎮 Gaming" },
  { q: "Which game studio made 'Elden Ring'?", options: ["FromSoftware", "Bandai Namco", "Square Enix", "CD Projekt Red"], answer: 0, category: "🎮 Gaming" },
  { q: "What color is the 'Impostor' in Among Us by default?", options: ["Red", "Blue", "Black", "Any color"], answer: 3, category: "🎮 Gaming" },
  { q: "Which battle royale game is known for its building mechanic?", options: ["Fortnite", "PUBG", "Warzone", "Apex Legends"], answer: 0, category: "🎮 Gaming" },
  { q: "What does 'NPC' stand for in gaming?", options: ["Non-Player Character", "New Playable Content", "Non-Playable Config", "Normal Player Control"], answer: 0, category: "🎮 Gaming" },
  { q: "In Minecraft, what material is needed to make a Nether portal?", options: ["Obsidian", "Diamond", "Iron", "Blackstone"], answer: 0, category: "🎮 Gaming" },

  // 🎌 Anime
  { q: "What is the name of the main character in 'Naruto'?", options: ["Naruto Uzumaki", "Sasuke Uchiha", "Kakashi Hatake", "Boruto Uzumaki"], answer: 0, category: "🎌 Anime" },
  { q: "Which anime features the 'Survey Corps'?", options: ["Attack on Titan", "Demon Slayer", "My Hero Academia", "Jujutsu Kaisen"], answer: 0, category: "🎌 Anime" },
  { q: "What is the power system in 'Hunter x Hunter' called?", options: ["Nen", "Chakra", "Quirk", "Haki"], answer: 0, category: "🎌 Anime" },
  { q: "Who is the author of 'One Piece'?", options: ["Eiichiro Oda", "Masashi Kishimoto", "Akira Toriyama", "Hajime Isayama"], answer: 0, category: "🎌 Anime" },
  { q: "In Dragon Ball Z, what level of Super Saiyan did Gohan first reach?", options: ["Super Saiyan 2", "Super Saiyan 1", "Super Saiyan 3", "Super Saiyan God"], answer: 0, category: "🎌 Anime" },
  { q: "What school does Izuku Midoriya attend in My Hero Academia?", options: ["U.A. High School", "Shiketsu High School", "Ketsubutsu High School", "Seiai Academy"], answer: 0, category: "🎌 Anime" },
  { q: "What is the name of the sword style used by Roronoa Zoro?", options: ["Santoryu", "Nitoryu", "Ittoryu", "Yontoryu"], answer: 0, category: "🎌 Anime" },
  { q: "In Jujutsu Kaisen, what is Gojo Satoru's special technique called?", options: ["Infinity", "Domain Expansion", "Black Flash", "Divergent Fist"], answer: 0, category: "🎌 Anime" },

  // 🌍 General Knowledge
  { q: "What is the capital city of Japan?", options: ["Tokyo", "Osaka", "Kyoto", "Hiroshima"], answer: 0, category: "🌍 General Knowledge" },
  { q: "How many sides does a hexagon have?", options: ["6", "5", "7", "8"], answer: 0, category: "🌍 General Knowledge" },
  { q: "What planet is known as the Red Planet?", options: ["Mars", "Jupiter", "Saturn", "Venus"], answer: 0, category: "🌍 General Knowledge" },
  { q: "What is the chemical symbol for gold?", options: ["Au", "Ag", "Go", "Gd"], answer: 0, category: "🌍 General Knowledge" },
  { q: "Who painted the Mona Lisa?", options: ["Leonardo da Vinci", "Michelangelo", "Raphael", "Picasso"], answer: 0, category: "🌍 General Knowledge" },
  { q: "What is the largest ocean on Earth?", options: ["Pacific", "Atlantic", "Indian", "Arctic"], answer: 0, category: "🌍 General Knowledge" },
  { q: "How many bones are in the adult human body?", options: ["206", "196", "216", "186"], answer: 0, category: "🌍 General Knowledge" },
  { q: "What language has the most native speakers in the world?", options: ["Mandarin Chinese", "Spanish", "English", "Hindi"], answer: 0, category: "🌍 General Knowledge" },
];

const CHAT_PROMPTS = [
  "🎮 **What game could you play for 24 hours straight without getting bored?**",
  "🏆 **What's your biggest gaming achievement you're actually proud of?**",
  "🎌 **Which anime character do you relate to the most and why?**",
  "💀 **What's the hardest game you've ever beaten?**",
  "🎵 **Do you listen to music while gaming? Drop your go-to playlist genre!**",
  "🌙 **Are you a night owl or early bird gamer?**",
  "🤝 **Solo player or multiplayer? Which do you prefer and why?**",
  "🔥 **What's a game everyone loves but you just can't get into?**",
  "😤 **What's the most tilting thing that can happen in a game?**",
  "🏅 **If you could be a pro gamer in any game, which would you pick?**",
  "📱 **Mobile gamer or console/PC? Defend your choice.**",
  "🎭 **If your life was an anime, what genre would it be?**",
  "🌟 **What's an underrated game you think everyone should play?**",
  "👾 **What was the first video game you ever played?**",
  "🍕 **What's your go-to snack when you're gaming?**",
  "⚔️ **RPG, FPS, or Strategy — which genre is the GOAT?**",
  "🎬 **Which anime deserves a proper video game adaptation?**",
  "💭 **Hot take: drop your most controversial gaming opinion.**",
];

// Track active trivia to prevent double-answering
const activeTriviaAnswers = new Map(); // messageId → Set of userIds who answered

function getRandomTrivia() {
  return TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];
}

function getRandomPrompt() {
  return CHAT_PROMPTS[Math.floor(Math.random() * CHAT_PROMPTS.length)];
}

async function sendTrivia(channel) {
  try {
    const q = getRandomTrivia();
    const labels = ["🇦", "🇧", "🇨", "🇩"];
    const letters = ["A", "B", "C", "D"];

    // Shuffle answer options but track correct answer
    const indices = [0, 1, 2, 3];
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const shuffledOptions = indices.map(i => q.options[i]);
    const correctShuffledIndex = indices.indexOf(q.answer);

    const optionText = shuffledOptions
      .map((opt, i) => `${labels[i]} ${opt}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`${q.category} Trivia! 🧠`)
      .setDescription(`**${q.q}**\n\n${optionText}\n\n⏱️ *Answer within 30 seconds!*`)
      .setColor(0xf1c40f)
      .setFooter({ text: "Click a button to answer • Only your first answer counts!" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      ...letters.map((letter, i) =>
        new ButtonBuilder()
          .setCustomId(`trivia_${letter}_${correctShuffledIndex}`)
          .setLabel(letter)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const msg = await channel.send({ embeds: [embed], components: [row] });
    activeTriviaAnswers.set(msg.id, { correct: correctShuffledIndex, voters: new Set(), correctUsers: [], wrongUsers: [] });

    // Reveal answer after 30 seconds
    setTimeout(async () => {
      try {
        const data = activeTriviaAnswers.get(msg.id);
        activeTriviaAnswers.delete(msg.id);

        const correctAnswer = shuffledOptions[correctShuffledIndex];
        const correctList = data.correctUsers.length
          ? data.correctUsers.map(u => `<@${u}>`).join(", ")
          : "Nobody got it right! 😬";

        const resultEmbed = new EmbedBuilder()
          .setTitle(`${q.category} Trivia — Results! 🏁`)
          .setDescription(`**${q.q}**\n\n✅ **Correct Answer: ${labels[correctShuffledIndex]} ${correctAnswer}**`)
          .addFields(
            { name: "🏆 Got it right", value: correctList, inline: false },
            { name: "📊 Total answers", value: `${data.voters.size} member(s) answered`, inline: false },
          )
          .setColor(0x57f287)
          .setTimestamp();

        // Disable all buttons
        const disabledRow = new ActionRowBuilder().addComponents(
          ...letters.map((letter, i) =>
            new ButtonBuilder()
              .setCustomId(`trivia_done_${i}`)
              .setLabel(`${letter}${i === correctShuffledIndex ? " ✓" : ""}`)
              .setStyle(i === correctShuffledIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(true)
          )
        );

        await msg.edit({ embeds: [resultEmbed], components: [disabledRow] });
      } catch (e) {
        console.error("❌ Trivia reveal failed:", e.message);
      }
    }, 30_000);

    console.log(`🧠 Trivia posted: ${q.q}`);
  } catch (e) {
    console.error("❌ Failed to send trivia:", e.message);
  }
}

async function sendChatPrompt(channel) {
  try {
    const prompt = getRandomPrompt();

    const embed = new EmbedBuilder()
      .setTitle("💬 Chat Prompt!")
      .setDescription(prompt + "\n\n*Drop your answer below — let's see what everyone thinks!* 👇")
      .setColor(0xe91e8c)
      .setFooter({ text: "Magic Tiles 3 Community • Daily Prompt" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log(`💬 Chat prompt posted.`);
  } catch (e) {
    console.error("❌ Failed to send prompt:", e.message);
  }
}

// ── Daily auto-scheduler ──────────────────────────────────────────────────────
function scheduleDailyEngagement() {
  const now = new Date();
  const next = new Date();
  next.setHours(DAILY_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1); // push to tomorrow if past time

  const msUntil = next - now;
  console.log(`📅 Daily engagement scheduled in ${Math.round(msUntil / 60000)} minutes.`);

  setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(ENGAGE_CHANNEL_ID);
      if (!channel) return console.error("❌ Engage channel not found!");

      // Alternate between trivia and prompt each day
      const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86_400_000);
      if (dayOfYear % 2 === 0) {
        await sendTrivia(channel);
      } else {
        await sendChatPrompt(channel);
      }
    } catch (e) {
      console.error("❌ Daily engagement failed:", e.message);
    }

    // Reschedule for next day
    scheduleDailyEngagement();
  }, msUntil);
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUMP SYSTEM
// ═════════════════════════════════════════════════════════════════════════════

async function sendBumpReminder() {
  try {
    const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
    if (!channel) return console.error("❌ Bump channel not found!");

    if (lastBotMessage) {
      try { await lastBotMessage.delete(); } catch (_) {}
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
      .setColor(0x5865f2)
      .setThumbnail("https://disboard.org/images/bot-command-image-disboard.png")
      .setFooter({ text: "Reminder sent every 15 minutes until bumped" })
      .setTimestamp();

    lastBotMessage = await channel.send({ embeds: [embed] });
    console.log(`✅ [${new Date().toLocaleString()}] Bump reminder sent!`);
  } catch (e) {
    console.error("❌ Failed to send bump reminder:", e.message);
  }
}

async function sendBumpSuccess(channel) {
  if (lastBotMessage) {
    try { await lastBotMessage.delete(); } catch (_) {}
    lastBotMessage = null;
  }

  const embed = new EmbedBuilder()
    .setTitle("✅ Server Bumped!")
    .setDescription(
      "**Thanks for bumping the server!** 🎉\n\n" +
      "The next reminder will be sent in **2 hours**.\n" +
      "Keep up the great work helping the server grow! 💪"
    )
    .setColor(0x57f287)
    .setFooter({ text: "Next reminder in 2 hours" })
    .setTimestamp();

  const sent = await channel.send({ embeds: [embed] });
  lastBotMessage = sent;

  setTimeout(async () => {
    try {
      await sent.delete();
      if (lastBotMessage?.id === sent.id) lastBotMessage = null;
    } catch (_) {}
  }, 10 * 60 * 1000);
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
  console.log("✅ Bump detected! Pausing reminders for 2 hours.");
  clearInterval(reminderInterval);
  sendBumpSuccess(channel);
  setTimeout(() => {
    sendBumpReminder();
    reminderInterval = setInterval(sendBumpReminder, REMINDER_INTERVAL_MS);
  }, 2 * 60 * 60 * 1000);
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
            "• Member for **at least 2 weeks**",
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
            "• Do **not** DM staff asking about your application",
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

    await channel.send({ embeds: [embed], components: [row] });
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

    // !wakeup [optional message] — ping @everyone to revive dead chat
    if (message.content.trim().startsWith("!wakeup")) {
      const customText = message.content.slice("!wakeup".length).trim();
      const randomLine = WAKEUP_MESSAGES[Math.floor(Math.random() * WAKEUP_MESSAGES.length)];

      const embed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setTitle("📣 WAKE UP CALL")
        .setDescription(
          `${randomLine}\n\n` +
          (customText ? `> ${customText}\n\n` : "") +
          `Drop a message, react, say anything — just let us know you're breathing. 💬`
        )
        .setFooter({ text: "Don't let the chat die. You're better than this." })
        .setTimestamp();

      try {
        await message.delete();
        await message.channel.send({ content: "@everyone", embeds: [embed] });
      } catch (e) {
        console.error("❌ Wake-up command failed:", e?.message ?? e);
      }
      return;
    }

    // !trivia — manually post a trivia question to the engage channel
    if (message.content.trim() === "!trivia") {
      try { await message.delete(); } catch (_) {}
      const channel = await client.channels.fetch(ENGAGE_CHANNEL_ID).catch(() => null);
      if (!channel) {
        const r = await message.channel.send("❌ Engage channel not found! Check `ENGAGE_CHANNEL_ID`.");
        setTimeout(() => r.delete().catch(() => {}), 5000);
        return;
      }
      await sendTrivia(channel);
      return;
    }

    // !prompt — manually post a chat prompt to the engage channel
    if (message.content.trim() === "!prompt") {
      try { await message.delete(); } catch (_) {}
      const channel = await client.channels.fetch(ENGAGE_CHANNEL_ID).catch(() => null);
      if (!channel) {
        const r = await message.channel.send("❌ Engage channel not found! Check `ENGAGE_CHANNEL_ID`.");
        setTimeout(() => r.delete().catch(() => {}), 5000);
        return;
      }
      await sendChatPrompt(channel);
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

  // ── Trivia answer buttons ─────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("trivia_") && !interaction.customId.startsWith("trivia_done_")) {
    const parts = interaction.customId.split("_"); // ["trivia", "A"/"B"/"C"/"D", correctIndex]
    const chosenLetter = parts[1];
    const correctIndex = parseInt(parts[2]);
    const letters = ["A", "B", "C", "D"];
    const chosenIndex = letters.indexOf(chosenLetter);

    const data = activeTriviaAnswers.get(interaction.message.id);
    if (!data) {
      await interaction.reply({ content: "⏱️ This trivia has already ended!", ephemeral: true });
      return;
    }
    if (data.voters.has(interaction.user.id)) {
      await interaction.reply({ content: "❌ You already answered this one!", ephemeral: true });
      return;
    }

    data.voters.add(interaction.user.id);
    const isCorrect = chosenIndex === correctIndex;
    if (isCorrect) {
      data.correctUsers.push(interaction.user.id);
    } else {
      data.wrongUsers.push(interaction.user.id);
    }

    await interaction.reply({
      content: isCorrect
        ? "✅ **Correct!** Nice one, you got it! 🎉"
        : `❌ **Wrong!** Better luck next time — the answer will be revealed shortly.`,
      ephemeral: true,
    });
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
  console.log(`🧠 Trivia & prompt system ready — type !trivia or !prompt`);

  sendBumpReminder();
  reminderInterval = setInterval(sendBumpReminder, REMINDER_INTERVAL_MS);
  scheduleDailyEngagement();
});

client.login(TOKEN);
