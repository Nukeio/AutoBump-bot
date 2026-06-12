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
const GIPHY_API_KEY       = process.env.GIPHY_API_KEY;        // Giphy API key for prompt GIFs
const REMINDER_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const ENGAGE_INTERVAL_MS   = 60 * 60 * 1000; // 1 hour

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

// ═════════════════════════════════════════════════════════════════════════════
//  TRIVIA & CHAT PROMPT SYSTEM  (powered by Open Trivia DB)
// ═════════════════════════════════════════════════════════════════════════════

// OpenTDB category IDs we want: 9=General, 11=Film, 12=Music, 14=TV, 15=Games, 31=Anime/Manga
const OPENTDB_CATEGORIES = [9, 11, 12, 14, 15, 31];
const CATEGORY_LABELS = {
  9:  "🌍 General Knowledge",
  11: "🎬 Entertainment: Film",
  12: "🎵 Entertainment: Music",
  14: "📺 Entertainment: TV",
  15: "🎮 Entertainment: Games",
  31: "🎌 Entertainment: Anime & Manga",
};

let opentdbToken = null; // Session token — prevents repeated questions

// Decode HTML entities returned by OpenTDB (e.g. &amp; &#039; &quot;)
function decodeHTML(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&hellip;/g, "…")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—");
}

// Get or refresh a session token from OpenTDB
async function getOpentdbToken() {
  try {
    const res  = await fetch("https://opentdb.com/api_token.php?command=request");
    const data = await res.json();
    if (data.response_code === 0) {
      opentdbToken = data.token;
      console.log("🔑 OpenTDB session token obtained.");
    }
  } catch (e) {
    console.error("❌ Failed to get OpenTDB token:", e.message);
  }
}

// Fetch one random trivia question from OpenTDB
async function fetchTriviaQuestion() {
  const catId = OPENTDB_CATEGORIES[Math.floor(Math.random() * OPENTDB_CATEGORIES.length)];
  const tokenParam = opentdbToken ? `&token=${opentdbToken}` : "";
  const url = `https://opentdb.com/api.php?amount=1&type=multiple&category=${catId}${tokenParam}`;

  const res  = await fetch(url);
  const data = await res.json();

  // Token exhausted — reset and retry once
  if (data.response_code === 4) {
    console.warn("⚠️ OpenTDB token exhausted, resetting...");
    await fetch(`https://opentdb.com/api_token.php?command=reset&token=${opentdbToken}`);
    return fetchTriviaQuestion();
  }

  if (data.response_code !== 0 || !data.results?.length) {
    throw new Error(`OpenTDB returned code ${data.response_code}`);
  }

  const raw = data.results[0];
  const question    = decodeHTML(raw.question);
  const correct     = decodeHTML(raw.correct_answer);
  const incorrects  = raw.incorrect_answers.map(decodeHTML);
  const category    = CATEGORY_LABELS[catId] ?? "🧠 Trivia";
  const difficulty  = raw.difficulty.charAt(0).toUpperCase() + raw.difficulty.slice(1);

  // Shuffle correct answer into random position
  const allAnswers = [...incorrects, correct];
  for (let i = allAnswers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allAnswers[i], allAnswers[j]] = [allAnswers[j], allAnswers[i]];
  }
  const correctIndex = allAnswers.indexOf(correct);

  return { question, correct, allAnswers, correctIndex, category, difficulty, catId };
}

const CHAT_PROMPTS = [
  // 🎮 Gaming
  "🎮 **What game could you play for 24 hours straight without getting bored?**",
  "🏆 **What's your biggest gaming achievement you're actually proud of?**",
  "💀 **What's the hardest game you've ever beaten?**",
  "🎵 **Do you listen to music while gaming? Drop your go-to playlist genre!**",
  "🌙 **Are you a night owl or early bird gamer?**",
  "🤝 **Solo player or multiplayer? Which do you prefer and why?**",
  "🔥 **What's a game everyone loves but you just can't get into?**",
  "😤 **What's the most tilting thing that can happen in a game?**",
  "🏅 **If you could be a pro gamer in any game, which would you pick?**",
  "📱 **Mobile gamer or console/PC? Defend your choice.**",
  "🌟 **What's an underrated game you think everyone should play?**",
  "👾 **What was the first video game you ever played?**",
  "🍕 **What's your go-to snack when you're gaming?**",
  "⚔️ **RPG, FPS, or Strategy — which genre is the GOAT?**",
  "💭 **Hot take: drop your most controversial gaming opinion.**",
  "🗺️ **Open world or linear story? Which do you prefer?**",
  "😱 **What game genuinely scared you the most?**",
  "🏚️ **What's a game you keep going back to no matter how old it is?**",
  "💸 **What's the most money you've ever spent on a game or in-game purchases?**",
  "🎯 **Are you a completionist or do you rush the main story?**",
  "🧠 **What game do you think has the best storyline ever?**",
  "🎤 **Which game has the best soundtrack in your opinion?**",
  "🤯 **What game mechanic blew your mind the first time you saw it?**",
  "👑 **Who's your all-time favourite video game character?**",
  "😂 **What's the funniest or most embarrassing gaming moment you've had?**",
  "🔫 **What's your loadout in your favourite shooter right now?**",
  "⚡ **Speed run or chill playthrough — how do you play?**",
  "🌐 **If you could live inside any game world, which one would you pick?**",

  // 🎌 Anime & Manga
  "🎌 **Which anime character do you relate to the most and why?**",
  "🎬 **Which anime deserves a proper video game adaptation?**",
  "🎭 **If your life was an anime, what genre would it be?**",
  "⚡ **Which anime power/ability would you want in real life?**",
  "😭 **Which anime moment hit you the hardest emotionally?**",
  "🔥 **What's your favourite anime fight scene of all time?**",
  "📺 **Currently watching any anime? Drop your recommendations!**",
  "🏆 **Top 3 anime of all time — go!**",
  "🤔 **Most overrated anime according to you?**",
  "🌟 **Which anime do you think is criminally underrated?**",
  "🎵 **What's the best anime opening song ever made?**",
  "💬 **Sub or dub — and why?**",
  "🦹 **Favourite anime villain and why?**",
  "📖 **Manga or anime — which do you prefer?**",
  "🏅 **If you could join any anime school or academy, which one?**",

  // 🌍 Community & Fun
  "☀️ **What's one thing that always puts you in a good mood?**",
  "🌍 **If you could travel anywhere in the world right now, where would you go?**",
  "🍔 **What's your go-to comfort food?**",
  "🧠 **What's a random fact you know that most people don't?**",
  "😴 **What's your sleep schedule like? Night owl or early bird?**",
  "📱 **What app do you spend the most time on besides Discord?**",
  "🎶 **What song is stuck in your head right now?**",
  "💡 **If you could have one superpower, what would it be?**",
  "📚 **Are you currently learning anything new? What is it?**",
  "🤩 **Who's someone you genuinely look up to and why?**",
  "😤 **What's your biggest pet peeve?**",
  "🐾 **Dogs, cats, or other — what's your favourite pet?**",
  "🌙 **What's the latest you've ever stayed up and why?**",
  "🎂 **What would your dream birthday be like?**",
  "🚀 **If you could have any job in the world, what would it be?**",
];

// ── Category thumbnail images for trivia (static, themed per category) ───────
const CATEGORY_IMAGES = {
  9:  "https://i.imgur.com/1yDzJpN.png",   // 🌍 General Knowledge — globe/quiz
  11: "https://i.imgur.com/AxPCwYS.png",   // 🎬 Film — clapperboard
  12: "https://i.imgur.com/NwXkxJv.png",   // 🎵 Music — musical notes
  14: "https://i.imgur.com/lKs3nqY.png",   // 📺 TV — television
  15: "https://i.imgur.com/ZQvtFSS.png",   // 🎮 Games — controller
  31: "https://i.imgur.com/OyIBDKG.png",   // 🎌 Anime — sakura/anime style
};

// ── Giphy fetch for prompts ───────────────────────────────────────────────────
// Maps prompt emoji prefix → Giphy search term
const PROMPT_GIPHY_TAGS = {
  "🎮": "gaming",
  "🏆": "victory gaming",
  "💀": "game over",
  "🎵": "music gaming",
  "🌙": "night gaming",
  "🤝": "multiplayer gaming",
  "🔥": "epic gaming",
  "😤": "rage gaming",
  "🏅": "pro gamer",
  "📱": "mobile gaming",
  "🌟": "awesome game",
  "👾": "retro gaming",
  "🍕": "gaming snack",
  "⚔️": "rpg fantasy",
  "💭": "thinking anime",
  "🗺️": "open world game",
  "😱": "scary game",
  "🏚️": "classic game",
  "💸": "spending money",
  "🎯": "achievement unlocked",
  "🧠": "big brain anime",
  "🎤": "game music",
  "🤯": "mind blown anime",
  "👑": "anime hero",
  "😂": "laughing anime",
  "🔫": "fps gaming",
  "⚡": "speedrun gaming",
  "🌐": "game world",
  "🎌": "anime",
  "🎬": "anime action",
  "🎭": "anime genre",
  "😭": "anime sad",
  "📺": "anime watching",
  "🤔": "anime thinking",
  "🎵": "anime music",
  "💬": "anime talking",
  "🦹": "anime villain",
  "📖": "manga reading",
  "☀️": "happy anime",
  "🌍": "travel adventure",
  "🍔": "food anime",
  "😴": "sleepy anime",
  "📱": "phone anime",
  "🎶": "music anime",
  "💡": "idea anime",
  "📚": "studying anime",
  "🤩": "excited anime",
  "🐾": "cute anime animal",
  "🎂": "anime celebration",
  "🚀": "anime dream",
};

async function fetchGiphyGif(searchTerm) {
  if (!GIPHY_API_KEY) return null;
  try {
    const offset = Math.floor(Math.random() * 20); // random result from top 20
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchTerm)}&limit=1&offset=${offset}&rating=g&lang=en`;
    const res  = await fetch(url);
    const data = await res.json();
    return data?.data?.[0]?.images?.original?.url ?? null;
  } catch (e) {
    console.error("❌ Giphy fetch failed:", e.message);
    return null;
  }
}



// Hourly toggle: even hours = trivia, odd hours = prompt
let engageToggle = 0;

async function sendTrivia(channel) {
  try {
    const q = await fetchTriviaQuestion();
    const labels  = ["🇦", "🇧", "🇨", "🇩"];
    const letters = ["A", "B", "C", "D"];

    const optionText = q.allAnswers.map((opt, i) => `${labels[i]} ${opt}`).join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`${q.category} Trivia! 🧠`)
      .setDescription(`**${q.question}**\n\n${optionText}\n\n⏱️ *Answer within 60 seconds!*`)
      .setColor(0xf1c40f)
      .addFields({ name: "Difficulty", value: q.difficulty, inline: true })
      .setThumbnail(CATEGORY_IMAGES[q.catId] ?? CATEGORY_IMAGES[9])
      .setFooter({ text: "Click a button to answer • Only your first answer counts! • Powered by OpenTDB" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      letters.map((letter, i) =>
        new ButtonBuilder()
          .setCustomId(`trivia_${letter}_${q.correctIndex}`)
          .setLabel(letter)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const msg = await channel.send({ embeds: [embed], components: [row] });
    activeTriviaAnswers.set(msg.id, {
      correctIndex: q.correctIndex,
      voters: new Set(),
      correctUsers: [],
      wrongUsers: [],
      allAnswers: q.allAnswers,
      question: q.question,
      category: q.category,
    });

    // Reveal answer after 60 seconds
    setTimeout(async () => {
      try {
        const data = activeTriviaAnswers.get(msg.id);
        if (!data) return;
        activeTriviaAnswers.delete(msg.id);

        const correctAnswer = data.allAnswers[data.correctIndex];
        const correctList = data.correctUsers.length
          ? data.correctUsers.map(u => `<@${u}>`).join(", ")
          : "Nobody got it right! 😬";

        const resultEmbed = new EmbedBuilder()
          .setTitle(`${data.category} Trivia — Results! 🏁`)
          .setDescription(`**${data.question}**\n\n✅ **Correct Answer: ${labels[data.correctIndex]} ${correctAnswer}**`)
          .addFields(
            { name: "🏆 Got it right", value: correctList, inline: false },
            { name: "📊 Responses", value: `${data.voters.size} member(s) answered`, inline: false },
          )
          .setColor(0x57f287)
          .setTimestamp();

        const disabledRow = new ActionRowBuilder().addComponents(
          letters.map((letter, i) =>
            new ButtonBuilder()
              .setCustomId(`trivia_done_${i}`)
              .setLabel(`${letter}${i === data.correctIndex ? " ✓" : ""}`)
              .setStyle(i === data.correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(true)
          )
        );

        await msg.edit({ embeds: [resultEmbed], components: [disabledRow] });
      } catch (e) {
        console.error("❌ Trivia reveal failed:", e.message);
      }
    }, 60_000);

    console.log(`🧠 Trivia posted: ${q.question}`);
  } catch (e) {
    console.error("❌ Failed to send trivia:", e.message);
  }
}

async function sendChatPrompt(channel) {
  try {
    const prompt = CHAT_PROMPTS[Math.floor(Math.random() * CHAT_PROMPTS.length)];

    // Detect the leading emoji to pick a Giphy search term
    const leadingEmoji = [...prompt][0]; // first character (emoji)
    const searchTerm   = PROMPT_GIPHY_TAGS[leadingEmoji] ?? "anime gaming";
    const gifUrl       = await fetchGiphyGif(searchTerm);

    const embed = new EmbedBuilder()
      .setTitle("💬 Chat Prompt!")
      .setDescription(prompt + "\n\n*Drop your answer below — let's see what everyone thinks!* 👇")
      .setColor(0xe91e8c)
      .setFooter({ text: "Magic Tiles 3 Community • Hourly Prompt" })
      .setTimestamp();

    if (gifUrl) embed.setImage(gifUrl);

    await channel.send({ embeds: [embed] });
    console.log(`💬 Chat prompt posted${gifUrl ? " with GIF" : " (no GIF)"}.`);
  } catch (e) {
    console.error("❌ Failed to send prompt:", e.message);
  }
}

// ── Hourly auto-scheduler ─────────────────────────────────────────────────────
function scheduleHourlyEngagement() {
  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(ENGAGE_CHANNEL_ID);
      if (!channel) return console.error("❌ Engage channel not found!");

      engageToggle++;
      if (engageToggle % 2 === 1) {
        await sendTrivia(channel);
      } else {
        await sendChatPrompt(channel);
      }
    } catch (e) {
      console.error("❌ Hourly engagement failed:", e.message);
    }
  }, ENGAGE_INTERVAL_MS);

  console.log(`⏰ Hourly engagement scheduler started (trivia & prompts alternating every hour).`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUMP SYSTEM
// ═════════════════════════════════════════════════════════════════════════════

async function sendBumpReminder() {
  try {
    const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
    if (!channel) return console.error("❌ Bump channel not found!");

    if (lastBotMessage) {
      const old = lastBotMessage;
      lastBotMessage = null; // clear before await so re-entrant calls don't double-delete
      try { await old.delete(); } catch (_) {}
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
    const msgToDelete = lastBotMessage; // capture reference before it can change
    lastBotMessage = null;              // clear immediately so double-triggers don't stack
    stickyTimeout = setTimeout(async () => {
      try { await msgToDelete.delete(); } catch (_) {}
      await sendBumpReminder();
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

    // Bot restarted or trivia already ended — disable the buttons cleanly
    if (!data) {
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          letters.map((letter, i) =>
            new ButtonBuilder()
              .setCustomId(`trivia_done_${i}`)
              .setLabel(`${letter}${i === correctIndex ? " ✓" : ""}`)
              .setStyle(i === correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(true)
          )
        );
        await interaction.update({ components: [disabledRow] });
      } catch (_) {
        await interaction.reply({ content: "⏱️ This trivia session has already ended!", ephemeral: true }).catch(() => {});
      }
      return;
    }

    if (data.voters.has(interaction.user.id)) {
      await interaction.reply({ content: "❌ You already answered this one!", ephemeral: true });
      return;
    }

    data.voters.add(interaction.user.id);
    const isCorrect = chosenIndex === data.correctIndex;
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

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`⏰ Bump reminders every 15 minutes`);
  console.log(`📋 Mod app system ready — type !modapp to post`);
  console.log(`🧠 Trivia & prompt system ready — type !trivia or !prompt`);

  sendBumpReminder();
  reminderInterval = setInterval(sendBumpReminder, REMINDER_INTERVAL_MS);

  await getOpentdbToken(); // Get OpenTDB session token on startup
  scheduleHourlyEngagement();
});

client.login(TOKEN);
