import { 
  Client, 
  Events, 
  Collection, 
  Guild, 
  GuildMember, 
  User, 
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  InteractionType,
  Interaction,
  ChannelType
} from 'discord.js';
import { createDiscordClient, DISCORD_TOKEN, PRODUCTION_CHANNEL_ID } from '../config/discord';
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
      } else if (interaction.type === InteractionType.MessageComponent && interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.type === InteractionType.ModalSubmit && interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
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
      } else if (interaction.isButton() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error processing your request!',
          ephemeral: true
        });
      } else if (interaction.isModalSubmit() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'There was an error processing your submission!',
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

    // Check if command is restricted to production channel or its threads
    if (!this.isChannelAllowed(interaction)) {
      await interaction.reply({
        content: '❌ This command can only be used in the designated support channel or its threads.',
        ephemeral: true
      });
      return;
    }

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

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    switch (customId) {
      case 'ask_followup':
        await this.handleFollowUpButton(interaction);
        break;
      case 'ask_clarify':
        await this.handleClarifyButton(interaction);
        break;
      case 'ask_sources':
        await this.handleSourcesButton(interaction);
        break;
      default:
        await interaction.reply({
          content: '❌ Unknown button interaction.',
          ephemeral: true
        });
    }
  }

  private async handleFollowUpButton(interaction: ButtonInteraction): Promise<void> {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
    
    const modal = new ModalBuilder()
      .setCustomId('followup_modal')
      .setTitle('Ask a Follow-up Question');

    const questionInput = new TextInputBuilder()
      .setCustomId('followup_question')
      .setLabel('Your follow-up question')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Ask a related question for more details...')
      .setRequired(true)
      .setMaxLength(500);

    const actionRow = new ActionRowBuilder<any>().addComponents(questionInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  }

  private async handleClarifyButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const originalMessage = interaction.message;
    const originalEmbed = originalMessage.embeds[0];
    
    // Try to extract the original question from embed fields first
    let originalQuestion = originalEmbed?.fields?.find(field => field.name === '❓ Your Question')?.value;
    
    // If not found in fields, try to extract from embed description or title
    if (!originalQuestion && originalEmbed) {
      // Look for question patterns in the description
      const description = originalEmbed.description || '';
      const mentionMatch = description.match(/<@\d+>\s*(.*)/);
      if (mentionMatch && mentionMatch[1]) {
        originalQuestion = mentionMatch[1].substring(0, 200); // Limit length
      } else if (description.length > 0) {
        originalQuestion = description.substring(0, 200);
      }
    }
    
    // If still no question found, use a generic clarification prompt
    const clarificationPrompt = originalQuestion 
      ? `Please provide a more detailed explanation for this question: "${originalQuestion}". Include specific examples and step-by-step guidance where applicable.`
      : `Please provide a more detailed explanation based on the previous conversation context. Include specific examples and step-by-step guidance where applicable.`;

    // Import QA services
    const { SimpleQueueService } = await import('./simple-queue');
    const queueService = new SimpleQueueService();

    try {
      // Determine if we're in a thread
      const channel = interaction.channel;
      const isThread = channel?.type === ChannelType.PrivateThread || channel?.type === ChannelType.PublicThread;
      const threadId = isThread ? channel?.id : undefined;
      const parentChannelId = isThread ? channel?.parentId : channel?.id;

      const jobId = await queueService.addQAJob({
        question: clarificationPrompt,
        userId: interaction.user.id,
        guildId: interaction.guild?.id || undefined,
        channelId: parentChannelId || undefined,
        threadId: threadId,
        contextMemory: true,
        language: 'en',
        customSystemPrompt: 'Provide a detailed, step-by-step explanation with specific examples. Focus on practical implementation and common pitfalls to avoid.'
      });

      const result = await queueService.processJob(jobId);
      
      if (!result) {
        throw new Error('Failed to process clarification request');
      }

      const { EmbedBuilder } = await import('discord.js');
      const clarificationEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('💡 Detailed Explanation')
        .setDescription(result.answer)
        .setFooter({ text: 'FBA Boss Assistant • Detailed Clarification' })
        .setTimestamp();

      // Only add the original question field if we found one
      if (originalQuestion) {
        clarificationEmbed.addFields(
          { name: '❓ Original Question', value: originalQuestion, inline: false }
        );
      }

      await interaction.editReply({ embeds: [clarificationEmbed] });

    } catch (error) {
      logger.error('Error processing clarification request:', error);
      await interaction.editReply({
        content: '❌ Sorry, I encountered an error while generating the detailed explanation. Please try again later.'
      });
    }
  }

  private async handleSourcesButton(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const originalMessage = interaction.message;
    const sourcesEmbed = originalMessage.embeds.find(embed => embed.title === '📚 Sources & References');
    
    if (!sourcesEmbed || !sourcesEmbed.description) {
      await interaction.editReply({
        content: '❌ No sources found for this response.'
      });
      return;
    }

    const { EmbedBuilder } = await import('discord.js');
    const detailedSourcesEmbed = new EmbedBuilder()
      .setColor(0x2F3136)
      .setTitle('📖 Complete Source Details')
      .setDescription(sourcesEmbed.description)
      .addFields(
        { 
          name: '💡 How to Use These Sources', 
          value: '• Review the lesson content in the order listed\n• Pay attention to timestamps for video content\n• Cross-reference multiple sources for comprehensive understanding\n• Take notes on key concepts mentioned', 
          inline: false 
        }
      )
      .setFooter({ text: 'FBA Boss Academy • Course Materials' })
      .setTimestamp();

    await interaction.editReply({ embeds: [detailedSourcesEmbed] });
  }

  private async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.customId === 'followup_modal') {
      await this.handleFollowUpModal(interaction);
    } else {
      await interaction.reply({
        content: '❌ Unknown modal submission.',
        ephemeral: true
      });
    }
  }

  private async handleFollowUpModal(interaction: ModalSubmitInteraction): Promise<void> {
    const followUpQuestion = interaction.fields.getTextInputValue('followup_question');
    
    if (!this.isChannelAllowedForModal(interaction)) {
      await interaction.reply({
        content: '❌ This action can only be performed in the designated support channel or its threads.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: false });

    const { SimpleQueueService } = await import('./simple-queue');
    const queueService = new SimpleQueueService();

    try {
      // Determine if we're in a thread
      const channel = interaction.channel;
      const isThread = channel?.type === ChannelType.PrivateThread || channel?.type === ChannelType.PublicThread;
      const threadId = isThread ? channel?.id : undefined;
      const parentChannelId = isThread ? channel?.parentId : channel?.id;

      const jobId = await queueService.addQAJob({
        question: followUpQuestion,
        userId: interaction.user.id,
        guildId: interaction.guild?.id || undefined,
        channelId: parentChannelId || undefined,
        threadId: threadId,
        contextMemory: true,
        language: 'en'
      });

      const result = await queueService.processJob(jobId);
      
      if (!result) {
        throw new Error('Failed to process follow-up question');
      }

      const confidencePercent = Math.round(result.confidence * 100);
      
      const sourcesText = result.sources.length > 0 
        ? result.sources.slice(0, 3).map((source, index) => {
            const lessonTitle = source.metadata.lessonTitle || source.metadata.lesson || source.title || 'Untitled Lesson';
            const concept = source.metadata.concept ? ` - ${source.metadata.concept}` : '';
            const unitInfo = source.metadata.unitTitle || (source.metadata.unit ? `Unit ${source.metadata.unit}` : '');
            const timestamp = source.metadata.timestamp ? ` [${source.metadata.timestamp}]` : '';
            
            let sourceStr = `**${index + 1}. ${lessonTitle}${concept}**`;
            
            if (unitInfo) {
              sourceStr += `\n📍 ${unitInfo}`;
            }
            
            if (timestamp) {
              sourceStr += `${timestamp}`;
            }
            
            return sourceStr;
          }).join('\n\n')
        : 'No specific sources found in the knowledge base.';

      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
      
      const responseEmbed = new EmbedBuilder()
        .setColor(confidencePercent >= 80 ? 0x00FF00 : confidencePercent >= 60 ? 0xFFFF00 : 0xFF6600)
        .setTitle('💡 Follow-up Answer')
        .setDescription(`<@${interaction.user.id}> ${result.answer}`)
        .addFields(
          { name: '❓ Your Follow-up Question', value: followUpQuestion, inline: false }
        )
        .setFooter({ text: 'FBA Boss Assistant • Follow-up Response' })
        .setTimestamp();

      const sourcesEmbed = new EmbedBuilder()
        .setColor(0x2F3136)
        .setTitle('📚 Sources & References')
        .setDescription(sourcesText);

      const actionRow = new ActionRowBuilder<any>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ask_followup')
            .setLabel('Another Follow-up')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('💬'),
          new ButtonBuilder()
            .setCustomId('ask_clarify')
            .setLabel('Need Clarification?')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❓'),
          new ButtonBuilder()
            .setCustomId('ask_sources')
            .setLabel('View Full Sources')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📖')
        );

      await interaction.editReply({ 
        embeds: [responseEmbed, sourcesEmbed],
        components: [actionRow]
      });

      logger.info(`Follow-up question answered for user ${interaction.user.username}: ${followUpQuestion} (${confidencePercent}% confidence)`);

    } catch (error) {
      logger.error('Error processing follow-up question:', error);
      await interaction.editReply({
        content: '❌ Sorry, I encountered an error while processing your follow-up question. Please try again later.'
      });
    }
  }

  private isChannelAllowed(interaction: ChatInputCommandInteraction | ButtonInteraction): boolean {
    const channel = interaction.channel;
    
    if (!channel) {
      return false;
    }

    // Allow in all channels - permissions managed through Discord
    return true;
  }

  private isChannelAllowedForModal(interaction: ModalSubmitInteraction): boolean {
    const channel = interaction.channel;
    
    if (!channel) {
      return false;
    }

    // Allow in all channels - permissions managed through Discord
    return true;
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