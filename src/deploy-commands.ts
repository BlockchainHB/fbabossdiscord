import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } from './config/discord';
import logger from './utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const commands: any[] = [];

// Load commands from the commands directory
const loadCommands = async () => {
  const commandsPath = join(__dirname, 'commands');
  const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js') || file.endsWith('.ts'));

  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(filePath);
    
    if ('data' in command.default && 'execute' in command.default) {
      commands.push(command.default.data.toJSON());
      logger.info(`Loaded command: ${command.default.data.name}`);
    } else {
      logger.warn(`The command at ${filePath} is missing required "data" or "execute" property.`);
    }
  }
};

const deployCommands = async () => {
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
    logger.error('Missing Discord configuration for command deployment');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    await loadCommands();
    logger.info(`Started refreshing ${commands.length} application (/) commands.`);

    let data: any;
    
    if (DISCORD_GUILD_ID) {
      // Deploy to specific guild (faster for development)
      data = await rest.put(
        Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
        { body: commands }
      );
      logger.info(`Successfully reloaded ${(data as any[]).length} guild application (/) commands.`);
    } else {
      // Deploy globally (slower, but available in all guilds)
      data = await rest.put(
        Routes.applicationCommands(DISCORD_CLIENT_ID),
        { body: commands }
      );
      logger.info(`Successfully reloaded ${(data as any[]).length} global application (/) commands.`);
    }

  } catch (error) {
    logger.error('Error deploying commands:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  deployCommands();
}

export { deployCommands };