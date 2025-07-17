import { DiscordClientService } from './services/discord-client';
import { Command } from './types/command';
import logger from './utils/logger';
import { readdirSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

class Bot {
  private discordClient: DiscordClientService;

  constructor() {
    this.discordClient = new DiscordClientService();
  }

  private async loadCommands(): Promise<void> {
    const commandsPath = join(__dirname, 'commands');
    const commandFiles = readdirSync(commandsPath).filter(file => 
      file.endsWith('.js') || file.endsWith('.ts')
    );

    for (const file of commandFiles) {
      try {
        const filePath = join(commandsPath, file);
        const command = await import(filePath);
        
        if ('data' in command.default && 'execute' in command.default) {
          this.discordClient.addCommand(command.default as Command);
          logger.info(`Loaded command: ${command.default.data.name}`);
        } else {
          logger.warn(`The command at ${filePath} is missing required "data" or "execute" property.`);
        }
      } catch (error) {
        logger.error(`Error loading command ${file}:`, error);
      }
    }
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        await this.discordClient.stop();
        logger.info('Bot shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }

  public async start(): Promise<void> {
    try {
      logger.info('Starting FBA Boss Discord Bot...');
      
      // Load commands
      await this.loadCommands();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      // Start Discord client
      await this.discordClient.start();
      
      logger.info('Bot started successfully!');
      
    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }
}

// Start the bot
const bot = new Bot();
bot.start().catch(error => {
  logger.error('Fatal error starting bot:', error);
  process.exit(1);
});