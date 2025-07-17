import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Command } from '../types/command';
import { SimpleQueueService } from '../services/simple-queue';
import logger from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask a question about the FBA course content')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('Your question about FBA course content')
        .setRequired(true)
        .setMaxLength(500)
    )
    .addBooleanOption(option =>
      option.setName('private')
        .setDescription('Make the response private (only visible to you)')
        .setRequired(false)
    ),
  
  async execute(interaction: ChatInputCommandInteraction) {
    const question = interaction.options.getString('question', true);
    const isPrivate = interaction.options.getBoolean('private') || false;

    // Defer the reply immediately (we have 3 seconds max before Discord times out)
    await interaction.deferReply({ ephemeral: isPrivate });

    try {
      // Initialize queue service
      const queueService = new SimpleQueueService();

      // Check rate limiting
      const rateLimit = await queueService.checkUserRateLimit(
        interaction.user.id, 
        interaction.guild?.id || 'dm'
      );

      if (!rateLimit.allowed) {
        const rateLimitEmbed = new EmbedBuilder()
          .setColor(0xFF6600)
          .setTitle('⏳ Rate Limit Exceeded')
          .setDescription('You\'ve reached the maximum number of questions per minute.')
          .addFields(
            { name: 'Remaining Requests', value: `${rateLimit.remainingRequests}`, inline: true },
            { name: 'Reset Time', value: `<t:${Math.floor(rateLimit.resetTime / 1000)}:R>`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [rateLimitEmbed] });
        return;
      }

      // Add job to queue
      const jobId = await queueService.addQAJob({
        question,
        userId: interaction.user.id,
        guildId: interaction.guild?.id || undefined,
        channelId: interaction.channel?.id || undefined,
        contextMemory: true,
        language: 'en'
      });

      // Show initial processing message
      const processingEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🔍 Question Received')
        .setDescription('Searching through FBA course content for your answer...')
        .addFields(
          { name: '❓ Your Question', value: question, inline: false }
        )
        .setFooter({ text: 'Expected response time: 5-15 seconds' })
        .setTimestamp();

      await interaction.editReply({ embeds: [processingEmbed] });

      // Process the job and wait for completion
      const result = await queueService.processJob(jobId);
      
      if (!result) {
        throw new Error('Job processing failed');
      }

      // Create beautiful response embed with proper source citations
      const confidencePercent = Math.round(result.confidence * 100);
      const confidenceEmoji = confidencePercent >= 80 ? '🟢' : confidencePercent >= 60 ? '🟡' : '🔴';
      
      // Format sources with lesson name and timestamp only
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

      // Create main response embed
      const responseEmbed = new EmbedBuilder()
        .setColor(confidencePercent >= 80 ? 0x00FF00 : confidencePercent >= 60 ? 0xFFFF00 : 0xFF6600)
        .setTitle('💡 FBA Course Assistant')
        .setDescription(`<@${interaction.user.id}> ${result.answer}`)
        .addFields(
          { name: '❓ Your Question', value: question, inline: false }
        )
        .setFooter({ text: 'FBA Boss Assistant • Powered by FBA Boss Academy' })
        .setTimestamp();

      // Create sources embed
      const sourcesEmbed = new EmbedBuilder()
        .setColor(0x2F3136)
        .setTitle('📚 Sources & References')
        .setDescription(sourcesText);

      // Create action row with helpful buttons
      const actionRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ask_followup')
            .setLabel('Follow-up Question')
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

      // Send the complete response
      await interaction.editReply({ 
        embeds: [responseEmbed, sourcesEmbed],
        components: [actionRow]
      });

      logger.info(`Question answered for user ${interaction.user.username}: ${question} (${confidencePercent}% confidence, ${result.processingTime}ms)`);

    } catch (error) {
      logger.error('Error processing question:', error);

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Error Processing Question')
        .setDescription('Sorry, I encountered an error while processing your question. This could be due to:')
        .addFields(
          { name: '❓ Your Question', value: question, inline: false },
          { name: '🔍 Possible Causes', value: '• OpenAI API issues\n• Vector database timeout\n• Network connectivity\n• System overload', inline: true },
          { name: '💡 What to try', value: '• Simplify your question\n• Try again in a moment\n• Contact support if it persists', inline: true },
          { name: '🐛 Error Details', value: `\`\`\`${error instanceof Error ? error.message : 'Unknown error'}\`\`\``, inline: false }
        )
        .setFooter({ text: 'If this error persists, please contact the administrators' })
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
} as Command;