import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

export const createDiscordClient = (): Client => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.User,
      Partials.GuildMember,
      Partials.ThreadMember,
    ],
  });

  return client;
};

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
export const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
export const PRODUCTION_CHANNEL_ID = process.env.PRODUCTION_CHANNEL_ID || '1396625770088104070';
export const MEMORY_MESSAGE_LIMIT = parseInt(process.env.MEMORY_MESSAGE_LIMIT || '10', 10);

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error('Missing Discord configuration. Please check your .env file.');
}