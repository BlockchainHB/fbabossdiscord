import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../types/command';
import { QAPipelineService } from '../services/qa-pipeline';
import { QueueService } from '../services/queue';
import logger from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Check the health status of the FBA Bot systems')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const startTime = Date.now();
      
      // Initialize services
      const qaPipeline = new QAPipelineService();
      const queueService = new QueueService();

      // Check system health
      const [healthStatus, queueStats] = await Promise.all([
        qaPipeline.getHealthStatus(),
        queueService.getQueueStats()
      ]);

      const checkTime = Date.now() - startTime;

      // Determine overall health
      const overallHealth = healthStatus.overall;
      const healthColor = overallHealth ? 0x00FF00 : 0xFF0000;
      const healthEmoji = overallHealth ? '✅' : '❌';

      // Create health embed
      const healthEmbed = new EmbedBuilder()
        .setColor(healthColor)
        .setTitle(`${healthEmoji} FBA Bot Health Status`)
        .setDescription(`System health check completed in ${checkTime}ms`)
        .addFields(
          {
            name: '🤖 OpenAI Service',
            value: healthStatus.openai ? '✅ Operational' : '❌ Down',
            inline: true
          },
          {
            name: '🔍 Pinecone Service',
            value: healthStatus.pinecone ? '✅ Operational' : '❌ Down',
            inline: true
          },
          {
            name: '🗄️ Database Service',
            value: healthStatus.database ? '✅ Operational' : '❌ Down',
            inline: true
          },
          {
            name: '📊 Queue Statistics',
            value: [
              `Active: ${queueStats.active}`,
              `Waiting: ${queueStats.waiting}`,
              `Completed: ${queueStats.completed}`,
              `Failed: ${queueStats.failed}`
            ].join('\n'),
            inline: true
          },
          {
            name: '⏱️ Performance',
            value: [
              `Check Time: ${checkTime}ms`,
              `Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
              `Uptime: ${Math.floor(process.uptime() / 60)}m`
            ].join('\n'),
            inline: true
          },
          {
            name: '🔧 System Info',
            value: [
              `Node.js: ${process.version}`,
              `Environment: ${process.env.NODE_ENV || 'development'}`,
              `Platform: ${process.platform}`
            ].join('\n'),
            inline: true
          }
        )
        .setFooter({ text: 'FBA Boss Health Monitor' })
        .setTimestamp();

      await interaction.editReply({ embeds: [healthEmbed] });

      logger.info(`Health check completed for user ${interaction.user.username} in ${checkTime}ms`);

    } catch (error) {
      logger.error('Error during health check:', error);

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Health Check Failed')
        .setDescription('Unable to complete system health check.')
        .addFields(
          {
            name: 'Error',
            value: error instanceof Error ? error.message : 'Unknown error',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
} as Command;