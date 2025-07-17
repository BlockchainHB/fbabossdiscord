import { 
  Client, 
  Events, 
  Collection, 
  Guild, 
  GuildMember, 
  User, 
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  InteractionType,
  Interaction
} from 'discord.js';
import { createDiscordClient, DISCORD_TOKEN } from '../config/discord';
import { DiscordDatabaseService } from './discord-database';
import { Command, CommandCollection } from '../types/command';
import logger from '../utils/logger';

export class DiscordClientService {
  private client: Client;
  private commands: Collection<string, Command>;
  private dbService: DiscordDatabaseService;

  constructor() {
    this.client = createDiscordClient();
    this.commands = new Collection();
    this.dbService = new DiscordDatabaseService();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, this.onReady.bind(this));
    this.client.on(Events.InteractionCreate, this.onInteractionCreate.bind(this));
    this.client.on(Events.GuildCreate, this.onGuildCreate.bind(this));
    this.client.on(Events.GuildDelete, this.onGuildDelete.bind(this));
    this.client.on(Events.GuildMemberAdd, this.onGuildMemberAdd.bind(this));
    this.client.on(Events.Error, this.onError.bind(this));
    this.client.on(Events.Warn, this.onWarn.bind(this));
  }

  private async onReady(): Promise<void> {
    if (!this.client.user) return;
    
    logger.info(`Discord bot logged in as ${this.client.user.tag}`);
    logger.info(`Bot is in ${this.client.guilds.cache.size} guilds`);

    // Sync all guilds and users to database
    await this.syncGuildsToDatabase();
  }

  private async onInteractionCreate(interaction: Interaction): Promise<void> {
    const startTime = Date.now();

    try {
      if (interaction.type === InteractionType.ApplicationCommand && interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.type === InteractionType.ApplicationCommandAutocomplete && interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
      }
    } catch (error) {
      logger.error('Error handling interaction:', error);
      
      const responseTime = Date.now() - startTime;
      
      // Log interaction to database
      if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
        await this.logInteractionToDatabase(interaction, responseTime, false, error instanceof Error ? error.message : 'Unknown error');
      }
      
      if (interaction.isChatInputCommand() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error while executing this command!',
          ephemeral: true
        });
      }
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);
    
    if (!command) {
      logger.warn(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    // Rate limiting is handled in the queue service for individual commands

    // Sync user to database
    await this.syncUserToDatabase(interaction.user);
    
    // Execute command
    const startTime = Date.now();
    await command.execute(interaction);
    const responseTime = Date.now() - startTime;

    // Log interaction to database
    await this.logInteractionToDatabase(interaction, responseTime, true);
  }

  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);
    
    if (!command || !command.autocomplete) {
      return;
    }

    await command.autocomplete(interaction);
  }

  private async onGuildCreate(guild: Guild): Promise<void> {
    logger.info(`Bot joined guild: ${guild.name} (${guild.id})`);
    await this.syncGuildToDatabase(guild);
  }

  private async onGuildDelete(guild: Guild): Promise<void> {
    logger.info(`Bot left guild: ${guild.name} (${guild.id})`);
    await this.dbService.deactivateGuild(guild.id);
  }

  private async onGuildMemberAdd(member: GuildMember): Promise<void> {
    await this.syncUserToDatabase(member.user);
  }

  private onError(error: Error): void {
    logger.error('Discord client error:', error);
  }

  private onWarn(warning: string): void {
    logger.warn('Discord client warning:', warning);
  }

  private async syncGuildsToDatabase(): Promise<void> {
    for (const [guildId, guild] of this.client.guilds.cache) {
      await this.syncGuildToDatabase(guild);
    }
  }

  private async syncGuildToDatabase(guild: Guild): Promise<void> {
    try {
      await this.dbService.upsertGuild({
        id: guild.id,
        name: guild.name,
        icon: guild.icon || undefined,
        owner_id: guild.ownerId,
        member_count: guild.memberCount
      });

      // Sync channels
      for (const [channelId, channel] of guild.channels.cache) {
        if (channel.isTextBased()) {
          await this.dbService.upsertChannel({
            id: channel.id,
            guild_id: guild.id,
            name: channel.name,
            type: channel.type,
            position: 'position' in channel ? channel.position : 0,
            topic: 'topic' in channel ? channel.topic || undefined : undefined,
            nsfw: 'nsfw' in channel ? channel.nsfw : false,
            parent_id: channel.parentId || undefined
          });
        }
      }

      logger.info(`Synced guild ${guild.name} to database`);
    } catch (error) {
      logger.error(`Error syncing guild ${guild.name} to database:`, error);
    }
  }

  private async syncUserToDatabase(user: User): Promise<void> {
    try {
      await this.dbService.upsertUser({
        id: user.id,
        username: user.username,
        discriminator: user.discriminator || undefined,
        avatar: user.avatar || undefined,
        bot: user.bot,
        system: user.system || false,
        verified: false, // User.verified doesn't exist in discord.js v14
        flags: user.flags?.bitfield || 0
      });
    } catch (error) {
      logger.error(`Error syncing user ${user.username} to database:`, error);
    }
  }


  private async logInteractionToDatabase(
    interaction: ChatInputCommandInteraction | AutocompleteInteraction,
    responseTime: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.dbService.createInteraction({
        id: interaction.id,
        type: interaction.type,
        guild_id: interaction.guild?.id,
        channel_id: interaction.channel?.id,
        user_id: interaction.user.id,
        command_name: 'commandName' in interaction ? interaction.commandName : undefined,
        command_options: 'options' in interaction && interaction.isChatInputCommand() ? this.extractCommandOptions(interaction) : {},
        response_time_ms: responseTime,
        success,
        error_message: errorMessage
      });
    } catch (error) {
      logger.error('Error logging interaction to database:', error);
    }
  }

  private extractCommandOptions(interaction: ChatInputCommandInteraction): Record<string, any> {
    const options: Record<string, any> = {};
    
    interaction.options.data.forEach(option => {
      options[option.name] = option.value;
    });

    return options;
  }

  public addCommand(command: Command): void {
    this.commands.set(command.data.name, command);
  }

  public async start(): Promise<void> {
    if (!DISCORD_TOKEN) {
      throw new Error('Discord token is not configured');
    }

    await this.client.login(DISCORD_TOKEN);
  }

  public async stop(): Promise<void> {
    logger.info('Shutting down Discord client...');
    await this.client.destroy();
  }

  public getClient(): Client {
    return this.client;
  }

  public getCommands(): Collection<string, Command> {
    return this.commands;
  }
}